import { http } from "./client";
import type { LogLevel } from "../lib/ws";

export interface OverviewStats {
  bots: { total: number; statuses: Record<string, number> };
  tokens: {
    day: { prompt: number; completion: number; total: number; calls: number };
    week: { prompt: number; completion: number; total: number; calls: number };
    month: { prompt: number; completion: number; total: number; calls: number };
  };
}

export interface UsageBucket {
  ts: number;
  botId: string;
  prompt: number;
  completion: number;
  total: number;
  calls: number;
}

export interface UsageResponse {
  range: "day" | "week" | "month";
  bucketSecs: number;
  buckets: UsageBucket[];
}

export interface LogRow {
  id: number;
  botId: string | null;
  level: LogLevel;
  scope: string;
  message: string;
  createdAt: number;
}

export const statsApi = {
  overview: () => http.get<OverviewStats>("/stats/overview"),
  usage: (range: "day" | "week" | "month") => http.get<UsageResponse>(`/stats/usage?range=${range}`),
  logs: (limit = 200, offset = 0) =>
    http.get<{ logs: LogRow[]; offset: number; limit: number }>(
      `/logs?limit=${limit}&offset=${offset}`,
    ),
};
