// MCP HTTP client registry. holds one Client per server id, lazily connected.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpServerRef {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const CLIENT_INFO = { name: "nyxal", version: "0.0.1" };

class McpRegistry {
  private clients = new Map<string, Client>();

  private async connect(server: McpServerRef): Promise<Client> {
    let transport: StreamableHTTPClientTransport;
    try {
      transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers },
      });
    } catch (err) {
      throw new Error(
        `Invalid MCP server URL "${server.url}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    await client.connect(transport);
    return client;
  }

  async getOrConnect(server: McpServerRef): Promise<Client> {
    const cached = this.clients.get(server.id);
    if (cached) return cached;
    const client = await this.connect(server);
    this.clients.set(server.id, client);
    return client;
  }

  /** List tools, throwing on connect failure. caller decides how to surface. */
  async listTools(server: McpServerRef): Promise<McpToolDef[]> {
    const client = await this.getOrConnect(server);
    const { tools } = await client.listTools();
    return (tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema:
        (t.inputSchema as Record<string, unknown> | undefined) ?? { type: "object", properties: {} },
    }));
  }

  /**
   * Call a tool. on failure the cached client is dropped so the next call reconnects
   */
  async callTool(server: McpServerRef, name: string, args: Record<string, unknown>): Promise<string> {
    let client: Client;
    try {
      client = await this.getOrConnect(server);
    } catch (err) {
      throw new Error(
        `MCP connect failed (${server.name}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    let result;
    try {
      result = await client.callTool({ name, arguments: args });
    } catch (err) {
      // drop the client
      await client.close().catch(() => {});
      this.clients.delete(server.id);
      throw new Error(
        `MCP callTool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return this.flattenResult(result);
  }

  private flattenResult(result: unknown): string {
    if (!result || typeof result !== "object") return JSON.stringify(result);
    const r = result as { content?: unknown; isError?: boolean };
    // per the MCP spec, isError results should be surfaced to the caller
    // (the LLM), NOT thrown. many MCP servers set isError even on soft
    // failures where the action actually succeeded. returning the text lets
    // the model decide what to do instead of killing the recursion loop.
    const text = this.flattenContent(r.content);
    if (r.isError) {
      return text || "(MCP tool returned an error with no content)";
    }
    return text;
  }

  private flattenContent(content: unknown): string {
    if (!Array.isArray(content)) {
      if (typeof content === "string") return content;
      return content ? JSON.stringify(content) : "";
    }
    return content
      .map((c) => {
        if (!c || typeof c !== "object") return String(c);
        const block = c as { type?: string; text?: unknown; data?: unknown };
        if (block.type === "text" && typeof block.text === "string") return block.text;
        return JSON.stringify(block);
      })
      .join("\n")
      .trim();
  }

  /** Drop a cached client (used after a server row changes or is deleted). */
  async disconnect(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (!client) return;
    await client.close().catch(() => {});
    this.clients.delete(serverId);
  }

  /** Drop all cached clients. used on shutdown. */
  async disconnectAll(): Promise<void> {
    const ids = [...this.clients.keys()];
    await Promise.all(ids.map((id) => this.disconnect(id)));
  }
}

export const mcpRegistry = new McpRegistry();
