// recursive command handling: run a recursive command (web search etc), inject
// its result back into the conversation, and re-prompt the llm for a follow-up.
// loops up to maxRecursionDepth

import type { BotCommand } from "../types";
import type { CommandRegistry, CommandExecutionContext } from "../commands";
import type { PromptDeps } from "../prompt";
import { generateFollowUpResponse } from "../prompt";
import { parseAIResponse } from "./responseParser";
import { splitCommands, type CommandContext } from "./botCommandHandler";
import type { CommandMetadataStore } from "../stores/commandMetadataStore";
import type { ResponseContext } from "./ResponseContexts";
import type { Logger } from "./logger";

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
  llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
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
  } = options;
  const log = deps.log;

  const split = splitCommands(registry, commands);
  let remainingInstant = split.instant.filter((c) => !recursiveNames.includes(c.name));
  let recursiveCmds = commands.filter((c) => recursiveNames.includes(c.name));
  let asyncCommands = [...split.async];
  let reply = initialReply;
  let replySent = false;
  let currentCommands: BotCommand[] = commands;

  for (let depth = 0; depth < maxRecursionDepth && recursiveCmds.length > 0; depth++) {
    if (reply && reply.trim()) {
      const msgId = await ctx.sendReply(reply);
      replySent = true;
      metadataStore.record(msgId, channelId, currentCommands);
    }

    const toolResultParts: string[] = [];
    for (const cmd of recursiveCmds) {
      try {
        const resultText = await executeRecursiveCommand(registry, log, cmd, execCtx);
        toolResultParts.push(resultText);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log.warn(`Recursive command ${cmd.name} failed: ${errMsg}`);
        toolResultParts.push(`[${cmd.name.toUpperCase()} FAILED: ${errMsg}]`);
      }
    }

    const toolResultContent = toolResultParts.join("\n\n---\n\n");

    try {
      const followUp = await generateFollowUpResponse(
        deps,
        llmMessages,
        model,
        temperature,
        initialResponse,
        toolResultContent,
        addNothink,
      );
      log.debug(`Follow-up LLM response (depth ${depth + 1}): ${followUp}`);

      const parsed = parseAIResponse(log, followUp);
      reply = parsed.reply;

      const newCommands = parsed.commands || [];
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
