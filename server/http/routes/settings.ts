// settings kv endpoints. these power the global Settings page
//
// GET   /api/settings           all key/value pairs
// PATCH /api/settings           update any subset, returns the new full map

import { Elysia, t } from "elysia";
import { db } from "../../db";
import { settings } from "../../db/schema";
import { eq } from "drizzle-orm";
import { refreshSettingsCache, getCachedSettings } from "./settingsCache";

// which keys are exposed to + editable from the ui.
const EDITABLE = new Set(["log_retention_days", "log_history", "log_level_default", "tool_log_retention_days"]);

function coerce(key: string, raw: string): string {
  if (key === "log_retention_days") {
    const n = Math.max(1, Math.min(3650, Math.floor(Number(raw) || 0)));
    return String(n);
  }
  if (key === "log_history") {
    const n = Math.max(50, Math.min(10000, Math.floor(Number(raw) || 0)));
    return String(n);
  }
  if (key === "tool_log_retention_days") {
    const n = Math.floor(Number(raw) || 0);
    return String(Math.max(0, Math.min(36500, n)));
  }
  if (key === "log_level_default") {
    const v = raw.toUpperCase();
    return ["DEBUG", "INFO", "WARN", "ERROR"].includes(v) ? v : "INFO";
  }
  return raw;
}

export const settingsRoutes = new Elysia({ prefix: "/api/settings" })
  .get("/", async () => {
    const rows = await db.select().from(settings);
    const out: Record<string, string> = {};
    for (const r of rows) {
      if (EDITABLE.has(r.key)) out[r.key] = r.value ?? "";
    }
    return out;
  })

  .patch(
    "/",
    async ({ body, set }) => {
      const updates = body as Record<string, string>;
      const applied: Record<string, string> = {};
      const now = new Date();
      for (const [key, raw] of Object.entries(updates)) {
        if (!EDITABLE.has(key)) {
          set.status = 400;
          return { error: `Unknown setting: ${key}` };
        }
        const value = coerce(key, String(raw));
        const existing = await db.select().from(settings).where(eq(settings.key, key));
        if (existing.length === 0) await db.insert(settings).values({ key, value, updatedAt: now });
        else await db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, key));

        applied[key] = value;
      }
      await refreshSettingsCache();
      return { ok: true, applied, settings: getCachedSettings() };
    },
    {
      body: t.Record(t.String(), t.String()),
    },
  );
