import { signal } from "@preact/signals";
import { statsApi } from "../api/stats";
import { recentLogs, type LogRow } from "../lib/ws";

export const historyLogs = signal<LogRow[]>([]);
export const loadingMore = signal(false);
export const hasMore = signal(true);

const PAGE_SIZE = 200;

/** fetch the next older page, prepending to historyLogs. */
export async function loadMoreLogs(): Promise<void> {
  if (loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    // cursor = oldest id across history + recent. start from recentLogs if no
    // history yet (so we page backward from where the ws history left off).
    const oldestHistory = historyLogs.value[0]?.id;
    const oldestRecent = recentLogs.value[0]?.id;
    const cursor = oldestHistory ?? oldestRecent;
    const page = await statsApi.logs({ limit: PAGE_SIZE, before: cursor });
    if (page.logs.length === 0) {
      hasMore.value = false;
    } else {
      const seen = new Set<number>();
      for (const r of historyLogs.value) seen.add(r.id!);
      for (const r of recentLogs.value) seen.add(r.id!);
      const fresh = page.logs.filter((r) => r.id != null && !seen.has(r.id));
      historyLogs.value = [...fresh.reverse(), ...historyLogs.value];
      if (page.logs.length < PAGE_SIZE) hasMore.value = false;
    }
  } finally {
    loadingMore.value = false;
  }
}

export function resetHistory(): void {
  historyLogs.value = [];
  hasMore.value = true;
}
