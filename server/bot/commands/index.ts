// build a per-bot command registry. registers every command def, then the bot
// derives its enabled set + the availableCommands list for the system prompt
// from its resolved config.

import type { BotRuntimeConfig } from "../../config/botConfig";
import { CommandRegistry, type CommandDef } from "./registry";
import {
  reactCommand,
  renameSelfCommand,
  renameUserCommand,
  setBioCommand,
  postStickerCommand,
  editOrAddToLorebookCommand,
} from "./base";
import {
  webSearchCommand,
  fetchWebpageCommand,
  searchAndFetchCommand,
  deepResearchCommand,
  crawlSiteCommand,
  generateImageCommand,
} from "./extended";

export { CommandRegistry } from "./registry";
export type {
  CommandDef,
  CommandKind,
  CommandResult,
  AsyncCommandResult,
  CommandExecutionContext,
} from "./registry";

const ALL_COMMANDS: CommandDef<any>[] = [
  reactCommand,
  renameSelfCommand,
  renameUserCommand,
  postStickerCommand,
  editOrAddToLorebookCommand,
  setBioCommand,
  generateImageCommand,
  webSearchCommand,
  fetchWebpageCommand,
  searchAndFetchCommand,
  deepResearchCommand,
  crawlSiteCommand,
];

export function buildRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  for (const def of ALL_COMMANDS) registry.register(def);
  return registry;
}

// commands to advertise in the system prompt (only enabled ones). 
export function availableCommands(config: BotRuntimeConfig): Record<string, unknown>[] {
  const registry = buildRegistry();
  return registry
    .enabledCommands(config)
    .map((c) => {
      const out: Record<string, unknown> = {
        name: c.name,
        args: c.args,
        description: c.description,
        enabled: true,
      };
      if (c.kind === "recursive") out.isRecursive = true;
      return out;
    });
}

export function recursiveCommandNames(config: BotRuntimeConfig): string[] {
  return buildRegistry()
    .enabledCommands(config)
    .filter((c) => c.kind === "recursive")
    .map((c) => c.name);
}
