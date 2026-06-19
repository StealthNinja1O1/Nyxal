// in-process settings cache. the ws hub (for history limit) + logger don't want
// to hit sqlite on every message, so we keep a small map here that's refreshed
// on boot, after every settings update, and every minute.
// import { getCachedSettings, refreshSettingsCache, getSettingNumber } from here

import { db } from "../../db";
import { settings } from "../../db/schema";

let cache: Record<string, string> = {};
let lastRefreshMs = 0;
const STALE_MS = 60_000;

export async function refreshSettingsCache(): Promise<void> {
  const rows = await db.select().from(settings);
  cache = {};
  for (const r of rows) cache[r.key] = r.value ?? "";
  lastRefreshMs = Date.now();
}

export function getCachedSettings(): Record<string, string> {
  return cache;
}

export function getSetting(key: string): string | undefined {
  maybeRefreshInBackground();
  return cache[key];
}

export function getSettingNumber(key: string, fallback: number): number {
  const v = getSetting(key);
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function maybeRefreshInBackground(): void {
  if (Date.now() - lastRefreshMs > STALE_MS) {
    lastRefreshMs = Date.now(); // prevent stampedes
    void refreshSettingsCache();
  }
}
