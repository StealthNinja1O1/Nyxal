// recursive command handling: run a recursive command (web search etc), inject
// its result back into the conversation, and re-prompt the llm for a follow-up.
// loops up to maxRecursionDepth

import type { BotCommand } from "../types";
import type { CommandRegistry, CommandExecutionContext } from "../commands";
import type { PromptDeps } from "../prompt";
import { generateFollowUpResponse } from "../prompt";
import { generateToolResponse, parseToolArguments } from "../api/llm";
import type { ToolCallWire, WireMessage } from "../api/llm";
import { AttachmentBuilder } from "discord.js";
import { parseAIResponse } from "./responseParser";
import {
  executeInstantCommands,
  executeAsyncCommands,
  type CommandContext,
} from "./botCommandHandler";
import type { CommandMetadataStore } from "../stores/commandMetadataStore";
import type { ResponseContext } from "./ResponseContexts";
import type { Logger } from "./logger";
import { logToolCall } from "../toolCallLogger";

// token budget for accumulated tool results within one chain. when the chain
// exceeds it, the OLDEST tool results get compressed to head+tail excerpts so
// structure stays visible (which tool, roughly what came back) but bulk text
// goes. newest results are always kept intact.
const TOOL_CHAIN_TOKEN_BUDGET = 10000;

// compress a tool result to head+tail excerpts with an omission marker.
// idempotent: an already-compressed result is short enough to pass through.
function compressResult(text: string): string {
  const HEAD = 400;
  const TAIL = 400;
  if (text.length <= HEAD + TAIL + 200) return text;
  const omitted = text.length - HEAD - TAIL;
  return `${text.slice(0, HEAD)}\n[... ${omitted} chars trimmed to stay inside the tool token budget ...]\n${text.slice(-TAIL)}`;
}

export interface RecursiveCommandResult {
  /** id of the last reply message sent (undefined when the model sent no text) */
  lastMessageId: string | undefined;
}

export interface ProcessRecursiveOptions {
  deps: PromptDeps;
  registry: CommandRegistry;
  metadataStore: CommandMetadataStore;
  recursiveNames: string[];
  llmMessages: WireMessage[];
  model: string;
  temperature: number;
  initialResponse: string;
  initialReply: string;
  commands: BotCommand[];
  maxRecursionDepth: number;
  addNothink: boolean;
  channelId: string;
  ctx: ResponseContext;
  commandCtx: CommandContext;
  execCtx?: CommandExecutionContext;
  /** native mode: the first assistant turn as wire data (content + tool_calls) */
  initialToolTurn?: WireMessage | null;
  /** presence hooks, wrapped around each turn's async (image gen etc) run */
  onAsyncStart?: () => void;
  onAsyncEnd?: () => void;
}

async function executeRecursiveCommand(
  registry: CommandRegistry,
  log: Logger,
  cmd: BotCommand,
  execCtx?: CommandExecutionContext,
): Promise<string> {
  const def = registry.get(cmd.name);
  if (!def || def.kind !== "recursive") throw new Error(`Unknown recursive command: ${cmd.name}`);
  // start/end logging happens in logToolCall, which wraps every call site
  const result = await def.execute(cmd.args as Record<string, unknown>, execCtx ?? ({} as CommandExecutionContext));
  if (typeof result !== "string") throw new Error(`Recursive command ${cmd.name} returned non-string result`);
  return result;
}

/** execute one native tool call + return its tool-result content. recursive
 *  tools run for real. instant/async tools never reach this anymore (they run
 *  before the recursion loop and are answered with real outcome notes); the
 *  "[accepted: ...]" stub stays only as a defensive fallback so every
 *  tool_call on the turn always has an answer, which strict providers
 *  (anthropic-style validation) require. */
async function executeNativeToolCall(
  call: ToolCallWire,
  opts: {
    registry: CommandRegistry;
    log: Logger;
    recursiveNames: string[];
    execCtx?: CommandExecutionContext;
    botId: string;
    channelId: string;
    guildId: string | null;
    messageId: string | null;
    depth: number;
  },
): Promise<string> {
  const args = parseToolArguments(call.function.arguments);
  if (args === null) {
    opts.log.warn(
      `Tool call ${call.function.name}: arguments were not valid JSON: ${call.function.arguments.slice(0, 200)}`,
    );
    return "[tool call failed: arguments were not valid JSON. Fix the arguments and call the tool again]";
  }
  const cmd: BotCommand = { name: call.function.name, args };
  const def = opts.registry.get(cmd.name);
  if (!def) return `[tool call failed: unknown tool "${cmd.name}"]`;
  if (!opts.recursiveNames.includes(cmd.name)) {
    // scheduled by the caller's split already; do NOT execute or re-queue here
    return `[accepted: ${cmd.name} is scheduled to run when this turn completes]`;
  }
  try {
    return await logToolCall(
      cmd.name,
      "recursive",
      cmd.args,
      {
        botId: opts.botId,
        channelId: opts.channelId,
        guildId: opts.guildId,
        messageId: opts.messageId,
        depth: opts.depth,
        log: opts.log,
      },
      () => executeRecursiveCommand(opts.registry, opts.log, cmd, opts.execCtx),
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    opts.log.warn(`Recursive tool ${cmd.name} failed: ${errMsg}`);
    return `[${cmd.name.toUpperCase()} FAILED: ${errMsg}]`;
  }
}

export async function processRecursiveCommands(options: ProcessRecursiveOptions): Promise<RecursiveCommandResult> {
  const {
    deps,
    registry,
    metadataStore,
    recursiveNames,
    llmMessages,
    model,
    temperature,
    initialResponse,
    initialReply,
    commands,
    maxRecursionDepth,
    addNothink,
    channelId,
    ctx,
    commandCtx,
    execCtx,
    initialToolTurn,
    onAsyncStart,
    onAsyncEnd,
  } = options;
  const log = deps.log;
  const nativeMode = deps.config.toolcallMode === "native" && !!deps.tools && deps.tools.length > 0;

  let recursiveCmds = commands.filter((c) => recursiveNames.includes(c.name));
  let reply = initialReply;
  let currentCommands: BotCommand[] = commands;
  const isAsyncName = (name: string) => registry.get(name)?.kind === "async";

  // ---- per-turn reply + non-recursive side effects ----
  let replySent = false;
  let lastMessageId: string | undefined;
  const sendTurnReply = async (text: string, cmds: BotCommand[]): Promise<void> => {
    if (!text || !text.trim()) return;
    const msgId = replySent ? await ctx.sendFollowUp(text) : await ctx.sendReply(text);
    replySent = true;
    if (msgId) {
      lastMessageId = msgId;
      metadataStore.record(msgId, channelId, cmds);
    }
  };

  const runTurnSideEffects = async (turnCmds: BotCommand[]): Promise<(string | null)[]> => {
    const notes: (string | null)[] = turnCmds.map(() => null);

    const instantCmds = turnCmds.filter((c) => !isAsyncName(c.name) && !recursiveNames.includes(c.name));
    if (instantCmds.length > 0) {
      const results = await executeInstantCommands(registry, log, instantCmds, commandCtx);
      for (let i = 0; i < instantCmds.length; i++) {
        const cmd = instantCmds[i]!;
        const res = results[i];
        if (!res) continue;
        if (res.success) log.info(`Command: ${res.message}`);
        else log.warn(`Command failed: ${res.message}`);
        notes[turnCmds.indexOf(cmd)] = res.success
          ? `[${cmd.name}: done]`
          : `[${cmd.name} failed: ${res.message}]`;
      }
    }

    const asyncCmds = turnCmds.filter((c) => isAsyncName(c.name));
    if (asyncCmds.length > 0) {
      onAsyncStart?.();
      try {
        const results = await executeAsyncCommands(registry, log, asyncCmds, commandCtx);
        for (let i = 0; i < asyncCmds.length; i++) {
          const cmd = asyncCmds[i]!;
          const res = results[i];
          let note: string;
          if (!res) {
            note = `[${cmd.name}: no result returned]`;
          } else if (res.success && res.attachments && res.attachments.length > 0) {
            const files = res.attachments.map((a) => new AttachmentBuilder(a.buffer, { name: a.name }));
            const label = res.mediaType ?? "image";
            const orient =
              label === "image" && res.orientation && res.orientation !== "(default)"
                ? `, ${res.orientation}`
                : "";
            const followUpText =
              deps.config.comfyui.includePromptInMessage && res.prompt
                ? `${label}: ${res.prompt}${orient}`
                : "";
            await ctx.sendFollowUp(followUpText, files);
            log.info(`Async command: ${res.message}`);
            const names = res.attachments.map((a) => a.name).slice(0, 3).join(", ");
            const count = res.attachments.length;
            note = `[${cmd.name}: done - delivered ${count} ${label}${count === 1 ? "" : "s"}${names ? `: ${names}` : ""}]`;
          } else if (res.success) {
            log.info(`Async command: ${res.message}`);
            note = `[${cmd.name}: done]`;
          } else {
            await ctx.sendFollowUp("*[The static interfered with the generation...]*");
            log.warn(`Async command failed: ${res.message}`);
            note = `[${cmd.name} failed: ${res.message}]`;
          }
          notes[turnCmds.indexOf(cmd)] = note;
        }
      } finally {
        onAsyncEnd?.();
      }
    }

    return notes;
  };

  await sendTurnReply(reply, currentCommands);
  let turnNotes = await runTurnSideEffects(currentCommands);

  // accumulated conversation for this chain: original request + every
  // assistant turn + tool result since. this is the loop-fix: depth N now
  // SEES depth N-1's results instead of only the original request context.
  const chain: WireMessage[] = [...llmMessages];
  const resultIdxs: number[] = []; // chain indices of tool result messages, oldest first
  let lastRawResponse = initialResponse; // json mode: raw response (incl. its commands) of the latest turn
  let lastToolTurn: WireMessage | null = initialToolTurn ?? null; // native mode: latest turn as wire data
  const chainTokens = () => chain.reduce((acc, m) => acc + deps.tokens.count(typeof m.content === "string" ? m.content : ""), 0);

  for (let depth = 0; depth < maxRecursionDepth && recursiveCmds.length > 0; depth++) {
    // ---- answer this turn's tool calls in the chain ----
    if (nativeMode && lastToolTurn) {
      const calls = lastToolTurn.tool_calls ?? [];
      chain.push({ role: "assistant", content: lastToolTurn.content ?? "", tool_calls: calls });

      for (let i = 0; i < calls.length; i++) {
        const call = calls[i]!;
        let result: string;
        if (recursiveNames.includes(call.function.name)) {
          result = await executeNativeToolCall(call, {
            registry,
            log,
            recursiveNames,
            execCtx,
            botId: execCtx?.botId ?? commandCtx.execCtx.botId,
            channelId: channelId ?? "",
            guildId: commandCtx.message?.guild?.id ?? null,
            messageId: commandCtx.message?.id ?? null,
            depth,
          });
        } else {
          result = turnNotes[i] ?? `[${call.function.name}: done]`;
        }
        chain.push({ role: "tool", tool_call_id: call.id, content: result });
        resultIdxs.push(chain.length - 1);
      }
    } else {
      const toolResultParts: string[] = [];
      for (const cmd of recursiveCmds) {
        try {
          const resultText = await logToolCall(
            cmd.name,
            "recursive",
            cmd.args as Record<string, unknown>,
            {
              botId: execCtx?.botId ?? commandCtx.execCtx.botId,
              channelId: channelId ?? null,
              guildId: commandCtx.message?.guild?.id ?? null,
              messageId: commandCtx.message?.id ?? null,
              depth,
              log,
            },
            () => executeRecursiveCommand(registry, log, cmd, execCtx),
          );
          toolResultParts.push(resultText);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          log.warn(`Recursive command ${cmd.name} failed: ${errMsg}`);
          toolResultParts.push(`[${cmd.name.toUpperCase()} FAILED: ${errMsg}]`);
        }
      }

      const sideNotes = turnNotes.filter((n): n is string => !!n);
      const parts = sideNotes.length > 0 ? [...toolResultParts, ...sideNotes] : toolResultParts;
      chain.push({ role: "assistant", content: lastRawResponse });
      chain.push({ role: "user", content: parts.join("\n\n---\n\n") });
      resultIdxs.push(chain.length - 1);
    }

    // stay inside budget: compress oldest tool results first, newest last.
    if (chainTokens() > TOOL_CHAIN_TOKEN_BUDGET) {
      for (const idx of resultIdxs) {
        if (chainTokens() <= TOOL_CHAIN_TOKEN_BUDGET) break;
        const m = chain[idx]!;
        if (typeof m.content === "string") m.content = compressResult(m.content);
      }
    }

    // ---- re-prompt ----
    try {
      let newCommands: BotCommand[];
      if (nativeMode && deps.tools) {
        const res = await generateToolResponse(
          deps.creds,
          log,
          model,
          chain,
          temperature,
          addNothink,
          deps.tools,
          "followup",
        );
        log.debug(`Follow-up LLM response (depth ${depth + 1}): ${res.content}`);
        lastRawResponse = res.content;
        // the reply may still be a json blob if a character prompt demands the
        // json format; parseAIResponse unwraps it and falls back to raw text.
        reply = parseAIResponse(log, res.content).reply;
        lastToolTurn =
          res.toolCalls.length > 0
            ? {
                role: "assistant",
                content: res.content,
                tool_calls: res.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function" as const,
                  function: { name: tc.name, arguments: tc.arguments },
                })),
              }
            : null;
        newCommands = res.toolCalls.map((tc) => ({ name: tc.name, args: tc.args }));
      } else {
        const followUp = await generateFollowUpResponse(deps, chain, model, temperature, addNothink);
        log.debug(`Follow-up LLM response (depth ${depth + 1}): ${followUp}`);
        lastRawResponse = followUp;

        const parsed = parseAIResponse(log, followUp);
        reply = parsed.reply;
        newCommands = parsed.commands ?? [];
      }

      recursiveCmds = newCommands.filter((c) => recursiveNames.includes(c.name));
      currentCommands = newCommands;
    } catch (error) {
      log.error(`Follow-up LLM call failed (depth ${depth + 1}):`, error);
      break;
    }

    await sendTurnReply(reply, currentCommands);
    turnNotes = await runTurnSideEffects(currentCommands);
  }

  if (recursiveCmds.length > 0)
    log.warn(
      `Max recursion depth (${maxRecursionDepth}) reached. ignoring ${recursiveCmds.length} remaining command(s): ${recursiveCmds.map((c) => c.name).join(", ")}`,
    );

  return { lastMessageId };
}
