import { http } from "./client";
import type { LogLevel } from "../lib/ws";

export interface OverviewStats {
  bots: { total: number; statuses: Record<string, number> };
  tokens: {
    day: { prompt: number; completion: number; total: number; calls: number };
    week: { prompt: number; completion: number; total: number; calls: number };
    month: { prompt: number; completion: number; total: number; calls: number };
  };
  recentBots: RecentBot[];
}

export interface RecentBot {
  id: string;
  name: string;
  status: string;
  model: string;
  lastCallAt: number | null;
  totalTokens: number;
  createdAt: number;
}

export interface UsageBucket {
  ts: number;
  total: number;
  prompt: number;
  completion: number;
  calls: number;
}

export interface UsageResponse {
  range: "day" | "week" | "month";
  bucketSecs: number;
  buckets: UsageBucket[];
}

export interface SystemStats {
  process: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    uptimeSec: number;
    cpuPercent: number;
  };
  system: {
    totalMem: number;
    freeMem: number;
    usedMem: number;
    cores: number;
    cpuPercent: number;
  };
  db: {
    path: string;
    sizeBytes: number;
  };
}

export interface LogRow {
  id: number;
  botId: string | null;
  level: LogLevel;
  scope: string;
  message: string;
  createdAt: number;
}

export interface LogsPage {
  logs: LogRow[];
  offset: number;
  limit: number;
  oldestId: number | null;
  newestId: number | null;
}

export const statsApi = {
  overview: () => http.get<OverviewStats>("/stats/overview"),
  usage: (range: "day" | "week" | "month") => http.get<UsageResponse>(`/stats/usage?range=${range}`),
  system: () => http.get<SystemStats>("/stats/system"),
  // cursor-based: pass `before` = oldest id seen so far to page backward in time.
  // omit it for the first page (newest rows).
  logs: (opts: { limit?: number; before?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit != null) params.set("limit", String(opts.limit));
    if (opts.before != null) params.set("before", String(opts.before));
    if (opts.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return http.get<LogsPage>(`/logs${qs ? "?" + qs : ""}`);
  },
};
