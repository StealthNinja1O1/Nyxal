// build a per-bot command registry. registers every builtin command def
// (plus any dynamic MCP command defs), then the bot derives its enabled
// set + the availableCommands list for the system prompt from its resolved
// config + tool overrides.

import type { ToolOverrides } from "../../../shared/types";
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
  CommandExecuteResult,
  CommandExecutionContext,
} from "./registry";

// canonical list of builtin commands. MCP defs get merged in at
// buildRegistry() time. exported so DiscordBot can rebuild the registry
// when MCP tools change via registry.reset([...BUILTIN_COMMANDS, ...mcpDefs]).
export const BUILTIN_COMMANDS: CommandDef<any>[] = [
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

/**
 * Build a fresh per-bot registry.
 * @param extraDefs dynamic command defs (typically MCP tools resolved from DB).
 */
export function buildRegistry(extraDefs: CommandDef<any>[] = []): CommandRegistry {
  const registry = new CommandRegistry();
  for (const def of BUILTIN_COMMANDS) registry.register(def);
  for (const def of extraDefs) registry.register(def);
  return registry;
}

// commands to advertise in the system prompt (only enabled ones after
// applying per-bot overrides). builtins only - MCP tools are merged into
// the live registry on the bot and re-advertised from there.
export function availableCommands(
  config: BotRuntimeConfig,
  overrides: ToolOverrides = {},
): Record<string, unknown>[] {
  const registry = buildRegistry();
  return registry
    .enabledCommands(config, overrides)
    .map((c) => {
      const o = overrides[c.name];
      const out: Record<string, unknown> = {
        name: c.name,
        args: c.args,
        description: o?.description ?? c.description,
        enabled: true,
      };
      if (c.kind === "recursive") out.isRecursive = true;
      return out;
    });
}

export function recursiveCommandNames(
  config: BotRuntimeConfig,
  overrides: ToolOverrides = {},
): string[] {
  return buildRegistry().recursiveNames(config, overrides);
}

/**
 * Advertise commands from an already-built registry (used when MCP defs
 * are merged in). Pulls description overrides from `overrides` too.
 */
export function availableCommandsFromRegistry(
  registry: CommandRegistry,
  config: BotRuntimeConfig,
  overrides: ToolOverrides = {},
): Record<string, unknown>[] {
  return registry
    .enabledCommands(config, overrides)
    .map((c) => {
      const o = overrides[c.name];
      const out: Record<string, unknown> = {
        name: c.name,
        args: c.args,
        description: o?.description ?? c.description,
        enabled: true,
      };
      if (c.kind === "recursive") out.isRecursive = true;
      return out;
    });
}
