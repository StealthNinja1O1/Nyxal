// tool call logger. one row per bot function/tool invocation. fire-and-forget
// insert - never blocks the bot, never throws into the call path.
//
// the three command dispatch points (instant / async / recursive) wrap their
// `def.execute()` calls with `logToolCall()` so every invocation gets recorded
// with args + success + timing, but NOT the result payload (kept lean).

import { db } from "../db";
import { toolCallLog } from "../db/schema";
import type { Logger } from "./utils/logger";

export interface ToolCallContext {
  botId: string;
  channelId?: string | null;
  guildId?: string | null;
  messageId?: string | null;
  depth?: number;
  log?: Logger;
}

function argsPreview(args: Record<string, unknown>): string {
  let json: string;
  try {
    json = JSON.stringify(args) ?? "{}";
  } catch {
    json = "(unserializable args)";
  }
  return json.length > 200 ? `${json.slice(0, 200)}…` : json;
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
  ctx.log?.info(
    `Tool call: ${name} (${kind}${ctx.depth ? `, depth ${ctx.depth}` : ""}): ${argsPreview(args)}`,
  );
  try {
    const result = await fn();
    if (
      result !== null &&
      typeof result === "object" &&
      "success" in result &&
      (result as { success: unknown }).success === false
    ) {
      success = false;
      const msg = (result as { message?: unknown }).message;
      errorMessage = typeof msg === "string" ? msg : "(command returned success=false)";
    }
    return result;
  } catch (err) {
    success = false;
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const ms = Math.round(performance.now() - ms0);
    ctx.log?.debug(`Tool call: ${name} finished in ${ms}ms${success ? "" : ` (FAILED: ${errorMessage})`}`);
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
        guildId: ctx.guildId ?? null,
        messageId: ctx.messageId ?? null,
        createdAt: new Date(startedAt),
      })
      .catch((err) => {
        console.error("[tool-call-log] failed to insert:", err);
      });
  }
}
