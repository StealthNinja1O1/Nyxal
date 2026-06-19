import { http } from "./client";
import type { McpServer, McpTool } from "@shared/types";

export interface McpServerCreate {
  name: string;
  url: string;
  headers?: Record<string, string>;
}
export interface McpServerPatch {
  name?: string;
  url?: string;
  headers?: Record<string, string>;
}
export interface McpRefetchResult {
  ok: boolean;
  toolCount?: number;
  error?: string;
}

export const mcpApi = {
  listServers: () => http.get<McpServer[]>("/mcp/servers"),
  createServer: (input: McpServerCreate) => http.post<McpServer>("/mcp/servers", input),
  updateServer: (id: string, patch: McpServerPatch) => http.patch<McpServer>(`/mcp/servers/${id}`, patch),
  deleteServer: (id: string) => http.del<{ ok: true }>(`/mcp/servers/${id}`),
  refetch: (id: string) => http.post<McpRefetchResult>(`/mcp/servers/${id}/refetch`),
  test: (id: string) => http.post<McpRefetchResult>(`/mcp/servers/${id}/test`),
  listTools: (id: string) => http.get<McpTool[]>(`/mcp/servers/${id}/tools`),
};
