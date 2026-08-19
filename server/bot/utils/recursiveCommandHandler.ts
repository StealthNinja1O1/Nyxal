// recursive command handling: run a recursive command (web search etc), inject
// its result back into the conversation, and re-prompt the llm for a follow-up.
// loops up to maxRecursionDepth

import type { BotCommand } from "../types";
import type { CommandRegistry, CommandExecutionContext } from "../commands";
import type { PromptDeps } from "../prompt";
import { generateFollowUpResponse } from "../prompt";
import { generateToolResponse, parseToolArguments } from "../api/llm";
import type { ToolCallWire, WireMessage } from "../api/llm";
import { parseAIResponse } from "./responseParser";
import { splitCommands, type CommandContext } from "./botCommandHandler";
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
  reply: string;
  remainingInstant: BotCommand[];
  asyncCommands: BotCommand[];
  finalCommands: BotCommand[];
  replySent: boolean;
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
}

async function executeRecursiveCommand(
  registry: CommandRegistry,
  log: Logger,
  cmd: BotCommand,
  execCtx?: CommandExecutionContext,
): Promise<string> {
  const def = registry.get(cmd.name);
  if (!def || def.kind !== "recursive") throw new Error(`Unknown recursive command: ${cmd.name}`);
  log.info(`${cmd.name}: ${JSON.stringify(cmd.args).slice(0, 120)}`);
  const result = await def.execute(cmd.args as Record<string, unknown>, execCtx ?? ({} as CommandExecutionContext));
  if (typeof result !== "string") throw new Error(`Recursive command ${cmd.name} returned non-string result`);
  return result;
}

/** execute one native tool call + return its tool-result content. recursive
 *  tools run for real; instant/async tools are bubbled up (they execute after
 *  the final reply, same cost shape as json mode) and acknowledged with a
 *  synthetic result so every tool_call on the turn has an answer, which
 *  strict providers (anthropic-style validation) require. */
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
    onBubble: (cmd: BotCommand) => void;
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
    opts.onBubble(cmd);
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
  } = options;
  const log = deps.log;
  const nativeMode = deps.config.toolcallMode === "native" && !!deps.tools && deps.tools.length > 0;

  const split = splitCommands(registry, commands);
  let remainingInstant = split.instant.filter((c) => !recursiveNames.includes(c.name));
  let recursiveCmds = commands.filter((c) => recursiveNames.includes(c.name));
  let asyncCommands = [...split.async];
  let reply = initialReply;
  let replySent = false;
  let currentCommands: BotCommand[] = commands;

  // accumulated conversation for this chain: original request + every
  // assistant turn + tool result since. this is the loop-fix: depth N now
  // SEES depth N-1's results instead of only the original request context.
  const chain: WireMessage[] = [...llmMessages];
  const resultIdxs: number[] = []; // chain indices of tool result messages, oldest first
  let lastRawResponse = initialResponse; // json mode: raw response (incl. its commands) of the latest turn
  let lastToolTurn: WireMessage | null = initialToolTurn ?? null; // native mode: latest turn as wire data
  const chainTokens = () => chain.reduce((acc, m) => acc + deps.tokens.count(typeof m.content === "string" ? m.content : ""), 0);

  for (let depth = 0; depth < maxRecursionDepth && recursiveCmds.length > 0; depth++) {
    if (reply && reply.trim()) {
      const msgId = await ctx.sendReply(reply);
      replySent = true;
      metadataStore.record(msgId, channelId, currentCommands);
    }

    // ---- run this turn's tools + append the exchange to the chain ----
    if (nativeMode && lastToolTurn) {
      const calls = lastToolTurn.tool_calls ?? [];
      chain.push({ role: "assistant", content: lastToolTurn.content ?? "", tool_calls: calls });
      for (const call of calls) {
        const result = await executeNativeToolCall(call, {
          registry,
          log,
          recursiveNames,
          execCtx,
          botId: execCtx?.botId ?? commandCtx.execCtx.botId,
          channelId: channelId ?? "",
          guildId: commandCtx.message?.guild?.id ?? null,
          messageId: commandCtx.message?.id ?? null,
          depth,
          onBubble: (cmd) => {
            if (registry.get(cmd.name)?.kind === "async") asyncCommands.push(cmd);
            else remainingInstant.push(cmd);
          },
        });
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

      chain.push({ role: "assistant", content: lastRawResponse });
      chain.push({ role: "user", content: toolResultParts.join("\n\n---\n\n") });
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

      const newSplit = splitCommands(registry, newCommands);
      remainingInstant.push(...newSplit.instant.filter((c) => !recursiveNames.includes(c.name)));
      asyncCommands.push(...newSplit.async);
      recursiveCmds = newCommands.filter((c) => recursiveNames.includes(c.name));
      currentCommands = newCommands;
    } catch (error) {
      log.error(`Follow-up LLM call failed (depth ${depth + 1}):`, error);
      break;
    }
  }

  if (recursiveCmds.length > 0)
    log.warn(
      `Max recursion depth (${maxRecursionDepth}) reached. ignoring ${recursiveCmds.length} remaining command(s): ${recursiveCmds.map((c) => c.name).join(", ")}`,
    );

  return { reply, remainingInstant, asyncCommands, finalCommands: currentCommands, replySent };
}
