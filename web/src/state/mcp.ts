import { signal } from "@preact/signals";
import { mcpApi, type McpServerCreate, type McpServerPatch } from "../api/mcp";
import type { McpServer } from "@shared/types";
import { toast } from "./toast";

export const mcpServers = signal<McpServer[]>([]);
export const mcpLoading = signal(false);

export async function loadMcpServers(): Promise<void> {
  mcpLoading.value = true;
  try {
    mcpServers.value = await mcpApi.listServers();
  } catch (err) {
    toast.show(`Failed to load MCP servers: ${msg(err)}`, "error");
  } finally {
    mcpLoading.value = false;
  }
}

function setServer(updated: McpServer): void {
  mcpServers.value = mcpServers.value.map((s) => (s.id === updated.id ? updated : s));
}

export async function createMcpServer(input: McpServerCreate): Promise<McpServer | null> {
  try {
    const created = await mcpApi.createServer(input);
    mcpServers.value = [...mcpServers.value, created];
    toast.show(`MCP server "${created.name}" added`, "success");
    // auto-refetch tools so the user doesn't have to click Refetch manually.
    // this also validates the connection right away.
    void refetchMcpServer(created.id);
    return created;
  } catch (err) {
    toast.show(`Create failed: ${msg(err)}`, "error");
    return null;
  }
}

export async function updateMcpServer(id: string, patch: McpServerPatch): Promise<boolean> {
  try {
    const updated = await mcpApi.updateServer(id, patch);
    setServer(updated);
    return true;
  } catch (err) {
    toast.show(`Save failed: ${msg(err)}`, "error");
    return false;
  }
}

export async function deleteMcpServer(id: string): Promise<boolean> {
  try {
    await mcpApi.deleteServer(id);
    mcpServers.value = mcpServers.value.filter((s) => s.id !== id);
    toast.show("MCP server removed", "success");
    return true;
  } catch (err) {
    toast.show(`Delete failed: ${msg(err)}`, "error");
    return false;
  }
}

export async function refetchMcpServer(id: string): Promise<boolean> {
  try {
    const r = await mcpApi.refetch(id);
    if (r.ok) {
      toast.show(`Refetched ${r.toolCount ?? 0} tool(s)`, "success");
    } else {
      toast.error(`Refetch failed: ${r.error ?? "unknown error"}`);
    }
    // pull fresh row (lastFetchedAt / lastFetchError / toolCount updated)
    const fresh = await mcpApi.listServers();
    mcpServers.value = fresh;
    return r.ok;
  } catch (err) {
    toast.show(`Refetch failed: ${msg(err)}`, "error");
    return false;
  }
}

export async function testMcpServer(id: string): Promise<boolean> {
  try {
    const r = await mcpApi.test(id);
    if (r.ok) {
      toast.show(`Connected, found ${r.toolCount ?? 0} tool(s)`, "success");
      return true;
    }
    toast.error(`Test failed: ${r.error ?? "unknown error"}`);
    return false;
  } catch (err) {
    toast.show(`Test failed: ${msg(err)}`, "error");
    return false;
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
