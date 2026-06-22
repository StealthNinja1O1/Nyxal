// instant + async command dispatch. thin layer over the per-bot registry.
// recursive commands are handled separately (recursiveCommandHandler) since
// they re-prompt the llm with tool results.
//
// every dispatch wraps def.execute() in logToolCall() so each invocation
// (react / generateImage / etc) lands in tool_call_log with args + outcome.

import type { Message } from "discord.js";
import type { BotCommand, ChatMemoryBook, RuntimeCharacter } from "../types";
import type { CommandRegistry, CommandResult, AsyncCommandResult, CommandExecutionContext } from "../commands";
import type { Logger } from "./logger";
import { logToolCall } from "../toolCallLogger";

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
      const reason = !def
        ? `Unknown command: ${cmd.name}`
        : `${cmd.name} should be handled by the recursion loop (max depth reached or not enabled)`;
      // log the dispatch failure so it shows up in tool_call_log too. 
      await logToolCall(
        cmd.name,
        "instant",
        cmd.args as Record<string, unknown>,
        {
          botId: context.execCtx.botId,
          channelId: context.message?.channelId ?? null,
          messageId: context.message?.id ?? null,
        },
        async () => {
          throw new Error(reason);
        },
      ).catch(() => {});
      results.push({ success: false, message: reason });
      continue;
    }
    try {
      const result = await logToolCall(
        cmd.name,
        "instant",
        cmd.args as Record<string, unknown>,
        {
          botId: context.execCtx.botId,
          channelId: context.message?.channelId ?? null,
          messageId: context.message?.id ?? null,
        },
        () => def.execute(cmd.args as Record<string, unknown>, context.execCtx) as Promise<CommandResult>,
      );
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
      const reason = `Unknown async command: ${cmd.name}`;
      // mirror the instant path: log the dispatch failure, then swallow rethrow.
      await logToolCall(
        cmd.name,
        "async",
        cmd.args as Record<string, unknown>,
        {
          botId: context.execCtx.botId,
          channelId: context.message?.channelId ?? null,
          messageId: context.message?.id ?? null,
        },
        async () => {
          throw new Error(reason);
        },
      ).catch(() => {});
      results.push({ success: false, message: reason });
      continue;
    }
    try {
      const result = await logToolCall(
        cmd.name,
        "async",
        cmd.args as Record<string, unknown>,
        {
          botId: context.execCtx.botId,
          channelId: context.message?.channelId ?? null,
          messageId: context.message?.id ?? null,
        },
        () => def.execute(cmd.args as Record<string, unknown>, context.execCtx) as Promise<AsyncCommandResult>,
      );
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
