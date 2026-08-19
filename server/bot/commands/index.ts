// build a per-bot command registry. registers every builtin command def
// (plus any dynamic MCP command defs), then the bot derives its enabled
// set + the availableCommands list for the system prompt from its resolved
// config + tool overrides.

import type { ToolOverrides } from "../../../shared/types";
import type { BotRuntimeConfig } from "../../config/botConfig";
import type { NativeToolDef } from "../api/llm";
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

/** does this workflow contain a <PROMPT2> placeholder anywhere? */
function workflowHasPrompt2(content: Record<string, unknown> | null): boolean {
  if (!content) return false;
  for (const node of Object.values(content)) {
    const inputs = (node as { inputs?: Record<string, unknown> } | null)?.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    for (const v of Object.values(inputs)) if (v === "<PROMPT2>") return true;
  }
  return false;
}

/**
 * Build a per-config description for generateImage that lists the actual
 * resolutions + workflows the bot has. Appended to the base description so
 * the LLM knows what to pass for orientation + workflow (+ prompt2).
 */
function describeGenerateImage(config: BotRuntimeConfig, base: string): string {
  const resList = config.comfyui.resolutions.map((r) => `${r.name} (${r.width}x${r.height})`).join(", ");
  const defaultRes = config.comfyui.resolutions[0]?.name ?? "(none)";
  const lines = [base];
  if (resList) {
    lines.push(`Available orientations: ${resList}. Default: ${defaultRes}.`);
  }
  if (config.comfyuiWorkflows.length > 0) {
    const anyPrompt2 = config.comfyuiWorkflows.some((w) => workflowHasPrompt2(w.content));
    const wfList = config.comfyuiWorkflows
      .map((w) => {
        const tags: string[] = [];
        if (w.id === config.comfyuiDefaultWorkflowId) tags.push("default");
        if (workflowHasPrompt2(w.content)) tags.push("takes prompt2");
        return `"${w.name}"${tags.length ? ` (${tags.join(", ")})` : ""}`;
      })
      .join(", ");
    lines.push(`Available workflows: ${wfList}. Pass workflow="<name>" to use a non-default one.`);
    if (anyPrompt2)
      lines.push(
        `Workflows marked "takes prompt2" replace their <PROMPT2> placeholder with the prompt2 argument. What it controls (negative prompt, lyrics, second caption, ...) depends on the workflow.`,
      );
  }
  return lines.join("\n");
}

/** synthesize a loose all-strings schema from the legacy `args` hint map.
 *  only used for defs without hand-written parameters. */
function synthSchema(args: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    props[k] = typeof v === "string" ? { type: "string", description: v } : { type: "string" };
  }
  return { type: "object", properties: props };
}

function toNativeTool(c: CommandDef<any>, config: BotRuntimeConfig, o?: ToolOverrides[string]): NativeToolDef {
  let description = o?.description ?? c.description;
  if (c.name === "generateImage" && !o?.description) description = describeGenerateImage(config, c.description);
  return {
    type: "function",
    function: {
      name: c.name,
      description,
      parameters: c.parameters ?? synthSchema(c.args),
    },
  };
}

/** the `tools` field for native tool calling, derived from an already-built
 *  registry (so MCP defs merged into the live bot are included). */
export function nativeToolsFromRegistry(
  registry: CommandRegistry,
  config: BotRuntimeConfig,
  overrides: ToolOverrides = {},
): NativeToolDef[] {
  return registry.enabledCommands(config, overrides).map((c) => toNativeTool(c, config, overrides[c.name]));
}

// commands to advertise in the system prompt (only enabled ones after
// applying per-bot overrides). builtins only - MCP tools are merged into
// the live registry on the bot and re-advertised from there.
export function availableCommands(config: BotRuntimeConfig, overrides: ToolOverrides = {}): Record<string, unknown>[] {
  const registry = buildRegistry();
  return registry.enabledCommands(config, overrides).map((c) => {
    const o = overrides[c.name];
    let description = o?.description ?? c.description;
    if (c.name === "generateImage" && !o?.description) description = describeGenerateImage(config, c.description);

    const out: Record<string, unknown> = {
      name: c.name,
      args: c.args,
      description,
      enabled: true,
    };
    if (c.kind === "recursive") out.isRecursive = true;
    return out;
  });
}

export function recursiveCommandNames(config: BotRuntimeConfig, overrides: ToolOverrides = {}): string[] {
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
  return registry.enabledCommands(config, overrides).map((c) => {
    const o = overrides[c.name];
    let description = o?.description ?? c.description;
    if (c.name === "generateImage" && !o?.description) description = describeGenerateImage(config, c.description);

    const out: Record<string, unknown> = {
      name: c.name,
      args: c.args,
      description,
      enabled: true,
    };
    if (c.kind === "recursive") out.isRecursive = true;
    return out;
  });
}
