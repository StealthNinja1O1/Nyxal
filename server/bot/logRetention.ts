// periodic log retention pruner. reads `log_retention_days` from settings and
// deletes any row older than that, hourly (and once on boot). run once + forget.
//
// also prunes tool_call_log using `tool_log_retention_days` (0 = keep forever).

import { db } from "../db";
import { logs, toolCallLog } from "../db/schema";
import { lt } from "drizzle-orm";
import { getSettingNumber } from "../http/routes/settingsCache";

const HOUR_MS = 60 * 60 * 1000;

export async function pruneOldLogs(): Promise<void> {
  const days = getSettingNumber("log_retention_days", 30);
  const cutoff = new Date(Date.now() - days * 24 * HOUR_MS);
  try {
    await db.delete(logs).where(lt(logs.createdAt, cutoff));
  } catch (err) {
    console.error("[retention] failed to prune logs:", err);
  }
  
  const toolDays = getSettingNumber("tool_log_retention_days", 365);
  if (toolDays > 0) {
    const toolCutoff = new Date(Date.now() - toolDays * 24 * HOUR_MS);
    try {
      await db.delete(toolCallLog).where(lt(toolCallLog.createdAt, toolCutoff));
    } catch (err) {
      console.error("[retention] failed to prune tool_call_log:", err);
    }
  }
}

export function startLogRetentionPruner(): void {
  void pruneOldLogs();
  setInterval(() => {
    void pruneOldLogs();
  }, HOUR_MS);
}
