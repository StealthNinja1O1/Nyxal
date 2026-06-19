import { db } from "./index";
import { settings } from "./schema";
import { eq } from "drizzle-orm";

/** Default setting values applied on first boot when a key is missing. */
const DEFAULTS: Record<string, string> = {
  log_retention_days: process.env.NYXAL_LOG_RETENTION_DAYS || "30",
  log_history: process.env.NYXAL_LOG_HISTORY || "500",
  log_level_default: "INFO",
  tool_log_retention_days: "365",
};

/**
 * Seed any missing settings keys with their defaults after migrations
 */
export async function seedSettings(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const existing = await db.select().from(settings).where(eq(settings.key, key));
    if (existing.length === 0) {
      await db.insert(settings).values({ key, value, updatedAt: new Date() });
    }
  }
}
