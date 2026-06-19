// tool call logger. one row per bot function/tool invocation. fire-and-forget
// insert - never blocks the bot, never throws into the call path.
//
// the three command dispatch points (instant / async / recursive) wrap their
// `def.execute()` calls with `logToolCall()` so every invocation gets recorded
// with args + success + timing, but NOT the result payload (kept lean).

import { db } from "../db";
import { toolCallLog } from "../db/schema";

export interface ToolCallContext {
  botId: string;
  channelId?: string | null;
  messageId?: string | null;
  depth?: number;
}

/**
 * run `fn`, record a tool_call_log row with args + outcome + timing. returns
 * whatever `fn` returns. never throws because of logging - if the insert
 * fails it's swallowed and logged to stderr.
 */
export async function logToolCall<T>(
  name: string,
  kind: "instant" | "async" | "recursive",
  args: Record<string, unknown>,
  ctx: ToolCallContext,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const ms0 = performance.now();
  let success = true;
  let errorMessage: string | undefined;
  try {
    return await fn();
  } catch (err) {
    success = false;
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const ms = Math.round(performance.now() - ms0);
    // fire-and-forget. id auto-increments.
    void db
      .insert(toolCallLog)
      .values({
        botId: ctx.botId,
        name,
        kind,
        args,
        success,
        errorMessage,
        ms,
        depth: ctx.depth ?? 0,
        channelId: ctx.channelId ?? null,
        messageId: ctx.messageId ?? null,
        createdAt: new Date(startedAt),
      })
      .catch((err) => {
        console.error("[tool-call-log] failed to insert:", err);
      });
  }
}
