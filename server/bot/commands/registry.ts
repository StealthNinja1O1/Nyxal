import type { Message } from "discord.js";
import type { BotRuntimeConfig } from "../../config/botConfig";
import type { ChatMemoryBook } from "../types";
import type { Logger } from "../utils/logger";

export type CommandKind = "instant" | "async" | "recursive";

// context handed to every command's execute()
export interface CommandExecutionContext {
  message: Message | null;
  config: BotRuntimeConfig;
  log: Logger;
  botId: string;
  chatMemoryBook: ChatMemoryBook;
  onChatMemoryUpdate?: (book: ChatMemoryBook) => void;
  upsertMemoryEntry: (
    book: ChatMemoryBook,
    entryName: string,
    keywords: string[],
    content: string,
  ) => Promise<ChatMemoryBook>;
}

export interface CommandResult {
  success: boolean;
  message: string;
}
export interface AsyncCommandResult extends CommandResult {
  attachment?: { buffer: Buffer; name: string };
  prompt?: string;
  orientation?: string;
}
export type CommandExecuteResult = CommandResult | string;

export interface CommandDef<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult extends CommandExecuteResult = CommandExecuteResult,
> {
  name: string;
  args: Record<string, unknown>;
  description: string;
  kind: CommandKind;
  enabled: (config: BotRuntimeConfig) => boolean;
  execute: (args: TArgs, ctx: CommandExecutionContext) => Promise<TResult>;
}

export class CommandRegistry {
  private commands = new Map<string, CommandDef<any>>();

  register(def: CommandDef<any>): void {
    if (this.commands.has(def.name)) throw new Error(`Command "${def.name}" registered more than once`);
    this.commands.set(def.name, def);
  }

  get(name: string): CommandDef<any> | undefined {
    return this.commands.get(name);
  }

  list(): CommandDef<any>[] {
    return [...this.commands.values()];
  }

  enabledCommands(config: BotRuntimeConfig): CommandDef<any>[] {
    return this.list().filter((c) => c.enabled(config));
  }

  recursiveNames(): string[] {
    return this.list()
      .filter((c) => c.kind === "recursive")
      .map((c) => c.name);
  }
}
