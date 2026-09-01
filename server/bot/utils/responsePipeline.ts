// unified response pipeline. all entry points (chat message, /ask, ask context
// menu) funnel through here. per model turn the visible order is:
//   send reply -> instant commands -> async commands (awaited, files
//   delivered) -> recursive tools -> re-prompt, up to maxRecursionDepth.
// only recursive tools cause follow-up LLM rounds.

import { Message } from "discord.js";
import { parseAIResponse } from "./responseParser";
import { processRecursiveCommands } from "./recursiveCommandHandler";
import type { CommandContext } from "./botCommandHandler";
import type { ResponseContext } from "./ResponseContexts";
import type { CommandRegistry, CommandExecutionContext } from "../commands";
import type { PromptDeps } from "../prompt";
import type { WireMessage } from "../api/llm";
import type { CommandMetadataStore } from "../stores/commandMetadataStore";
import type { ChatMemoryBook, RuntimeCharacter, BotCommand } from "../types";
import type { Logger } from "./logger";

export interface ResponsePipelineOptions {
  deps: PromptDeps;
  registry: CommandRegistry;
  metadataStore: CommandMetadataStore;
  recursiveNames: string[];
  rawResponse: string;
  llmMessages: WireMessage[];
  model: string;
  temperature: number;
  ctx: ResponseContext;
  channelId: string;
  maxRecursionDepth: number;
  addNothink: boolean;
  message: Message | null;
  character: RuntimeCharacter;
  execCtx: CommandExecutionContext;
  nativeCommands?: BotCommand[] | null;
  initialToolTurn?: WireMessage | null;
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
    nativeCommands,
    initialToolTurn,
    onAsyncStart,
    onAsyncEnd,
  } = opts;
  const log: Logger = deps.log;

  // native mode: commands come from tool_calls, not the json format. the reply
  // text may still carry a json wrapper (character prompts can demand it) so
  // unwrap for display but ignore any commands found inside the text.
  const parsed = nativeCommands
    ? { reply: parseAIResponse(log, rawResponse).reply, commands: nativeCommands, success: true, raw: rawResponse }
    : parseAIResponse(log, rawResponse);
  const allCommands = parsed.commands || [];

  const commandCtx: CommandContext = { message, character, execCtx };

  const { lastMessageId } = await processRecursiveCommands({
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
    initialToolTurn,
    onAsyncStart,
    onAsyncEnd,
  });

  return lastMessageId;
}

export type { ChatMemoryBook };
