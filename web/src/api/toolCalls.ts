import { http } from "./client";

export type ToolKind = "instant" | "async" | "recursive";

export interface ToolCall {
  id: number;
  botId: string;
  botName: string;
  name: string;
  kind: ToolKind;
  args: Record<string, unknown>;
  success: boolean;
  errorMessage: string | null;
  ms: number;
  depth: number;
  channelId: string | null;
  messageId: string | null;
  createdAt: number;
}

export interface ToolCallsPage {
  calls: ToolCall[];
  limit: number;
  oldestId: number | null;
  hasMore: boolean;
}

export interface ToolCallsQuery {
  botId?: string;
  name?: string;
  kind?: ToolKind;
  success?: boolean;
  q?: string;
  before?: number;
  limit?: number;
}

export const toolCallsApi = {
  list: (query: ToolCallsQuery = {}) => {
    const params = new URLSearchParams();
    if (query.botId) params.set("botId", query.botId);
    if (query.name) params.set("name", query.name);
    if (query.kind) params.set("kind", query.kind);
    if (query.success != null) params.set("success", String(query.success));
    if (query.q) params.set("q", query.q);
    if (query.before != null) params.set("before", String(query.before));
    if (query.limit != null) params.set("limit", String(query.limit));
    const qs = params.toString();
    return http.get<ToolCallsPage>(`/tool-calls${qs ? "?" + qs : ""}`);
  },
  names: () => http.get<string[]>("/tool-calls/names"),
};
