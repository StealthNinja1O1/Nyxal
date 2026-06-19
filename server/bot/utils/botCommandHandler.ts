// instant + async command dispatch. thin layer over the per-bot registry.
// recursive commands are handled separately (recursiveCommandHandler) since
// they re-prompt the llm with tool results.

import type { Message } from "discord.js";
import type { BotCommand, ChatMemoryBook, RuntimeCharacter } from "../types";
import type { CommandRegistry, CommandResult, AsyncCommandResult, CommandExecutionContext } from "../commands";
import type { Logger } from "./logger";

export type CommandContext = {
  message: Message | null;
  character: RuntimeCharacter;
  execCtx: CommandExecutionContext;
};

export function splitCommands(registry: CommandRegistry, commands: BotCommand[]) {
  const asyncNames = new Set(
    registry.list().filter((c) => c.kind === "async").map((c) => c.name),
  );
  return {
    instant: commands.filter((c) => !asyncNames.has(c.name)),
    async: commands.filter((c) => asyncNames.has(c.name)),
  };
}

export async function executeInstantCommands(
  registry: CommandRegistry,
  log: Logger,
  commands: BotCommand[],
  context: CommandContext,
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  for (const cmd of commands) {
    const def = registry.get(cmd.name);
    if (!def || def.kind !== "instant") {
      if (def && def.kind === "recursive") {
        results.push({
          success: false,
          message: `${cmd.name} should be handled by the recursion loop (max depth reached or not enabled)`,
        });
      } else results.push({ success: false, message: `Unknown command: ${cmd.name}` });
      continue;
    }
    try {
      const result = (await def.execute(cmd.args as Record<string, unknown>, context.execCtx)) as CommandResult;
      results.push(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ success: false, message: `Error executing ${cmd.name}: ${errorMsg}` });
      log.error(`Error executing command ${cmd.name}:`, error);
    }
  }
  return results;
}

export async function executeAsyncCommands(
  registry: CommandRegistry,
  log: Logger,
  commands: BotCommand[],
  context: CommandContext,
): Promise<AsyncCommandResult[]> {
  const results: AsyncCommandResult[] = [];
  for (const cmd of commands) {
    const def = registry.get(cmd.name);
    if (!def || def.kind !== "async") {
      results.push({ success: false, message: `Unknown async command: ${cmd.name}` });
      continue;
    }
    try {
      const result = (await def.execute(cmd.args as Record<string, unknown>, context.execCtx)) as AsyncCommandResult;
      results.push(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ success: false, message: `Error executing ${cmd.name}: ${errorMsg}` });
      log.error(`Error executing async command ${cmd.name}:`, error);
    }
  }
  return results;
}

export type { ChatMemoryBook };
