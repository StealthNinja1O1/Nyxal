// unified response pipeline. all entry points (chat message, /ask, ask context
// menu) funnel through here.
//   parse response -> recursive commands -> instant commands -> send reply ->
//   async commands -> record metadata

import { AttachmentBuilder, Message } from "discord.js";
import { parseAIResponse } from "./responseParser";
import { processRecursiveCommands } from "./recursiveCommandHandler";
import { executeInstantCommands, executeAsyncCommands, type CommandContext } from "./botCommandHandler";
import type { ResponseContext } from "./ResponseContexts";
import type { CommandRegistry, CommandExecutionContext } from "../commands";
import type { PromptDeps } from "../prompt";
import type { CommandMetadataStore } from "../stores/commandMetadataStore";
import type { ChatMemoryBook, RuntimeCharacter } from "../types";
import type { Logger } from "./logger";

export interface ResponsePipelineOptions {
  deps: PromptDeps;
  registry: CommandRegistry;
  metadataStore: CommandMetadataStore;
  recursiveNames: string[];
  rawResponse: string;
  llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model: string;
  temperature: number;
  ctx: ResponseContext;
  channelId: string;
  maxRecursionDepth: number;
  addNothink: boolean;
  message: Message | null;
  character: RuntimeCharacter;
  execCtx: CommandExecutionContext;
  onAsyncStart?: () => void;
  onAsyncEnd?: () => void;
}

export async function runResponsePipeline(opts: ResponsePipelineOptions): Promise<string | undefined> {
  const {
    deps,
    registry,
    metadataStore,
    recursiveNames,
    rawResponse,
    llmMessages,
    model,
    temperature,
    ctx,
    channelId,
    maxRecursionDepth,
    addNothink,
    message,
    character,
    execCtx,
    onAsyncStart,
    onAsyncEnd,
  } = opts;
  const log: Logger = deps.log;

  const parsed = parseAIResponse(log, rawResponse);
  const allCommands = parsed.commands || [];

  const commandCtx: CommandContext = { message, character, execCtx };

  const {
    reply,
    remainingInstant,
    asyncCommands,
    finalCommands,
    replySent,
  } = await processRecursiveCommands({
    deps,
    registry,
    metadataStore,
    recursiveNames,
    llmMessages,
    model,
    temperature,
    initialResponse: rawResponse,
    initialReply: parsed.reply,
    commands: allCommands,
    maxRecursionDepth,
    addNothink,
    channelId,
    ctx,
    commandCtx,
    execCtx,
  });

  if (remainingInstant.length > 0) {
    const instantResults = await executeInstantCommands(registry, log, remainingInstant, commandCtx);
    for (const result of instantResults) {
      if (result.success) log.info(`Command: ${result.message}`);
      else log.warn(`Command failed: ${result.message}`);
    }
  }

  let finalMsgId: string | undefined;
  if (reply && reply.trim()) {
    finalMsgId = replySent ? await ctx.sendFollowUp(reply) : await ctx.sendReply(reply);
    metadataStore.record(finalMsgId, channelId, finalCommands);
  }

  if (asyncCommands.length > 0) {
    onAsyncStart?.();
    try {
      const asyncResults = await executeAsyncCommands(registry, log, asyncCommands, commandCtx);
      for (const result of asyncResults) {
        if (result.success && result.attachment) {
          const file = new AttachmentBuilder(result.attachment.buffer, { name: result.attachment.name });
          const followUpText =
            deps.config.comfyui.includePromptInMessage && result.prompt
              ? `image: ${result.prompt}, ${result.orientation ?? "square"}`
              : "";
          await ctx.sendFollowUp(followUpText, [file]);
          log.info(`Async command: ${result.message}`);
        } else if (result.success) {
          log.info(`Async command: ${result.message}`);
        } else {
          await ctx.sendFollowUp("*[The static interfered with the image generation...]*");
          log.warn(`Async command failed: ${result.message}`);
        }
      }
    } finally {
      onAsyncEnd?.();
    }
  }

  return finalMsgId;
}

export type { ChatMemoryBook };
