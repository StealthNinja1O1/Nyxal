// build CommandDef wrappers for MCP tools. one CommandDef per discovered
// tool. namespace: `mcp__<sanitizedServerName>__<toolName>`

import type { CommandDef } from "../commands/registry";
import { mcpRegistry, type McpServerRef, type McpToolDef } from "./McpRegistry";

export function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40) || "server";
}

export function mcpCommandName(serverName: string, toolName: string): string {
  return `mcp__${sanitizeServerName(serverName)}__${toolName}`;
}

/** Flatten a JSON Schema into the {name: "type hint"} map the prompt uses. */
export function schemaToArgs(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<
    string,
    { type?: string; enum?: unknown[]; description?: string }
  >;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    let typeStr: string;
    if (Array.isArray(v.enum) && v.enum.length > 0) {
      typeStr = `enum: ${v.enum.map((x) => JSON.stringify(x)).join(" | ")}`;
    } else {
      typeStr = v.type ?? "any";
    }
    out[k] = required.has(k) ? typeStr : `${typeStr} (optional)`;
  }
  return out;
}

export function buildMcpCommandDef(server: McpServerRef, tool: McpToolDef): CommandDef {
  const toolName = tool.name;
  return {
    name: mcpCommandName(server.name, tool.name),
    args: schemaToArgs(tool.inputSchema),
    description: `[MCP ${server.name}] ${tool.description || "(no description provided)"}`,
    kind: "recursive",
    defaultEnabled: () => true,
    execute: async (args) => {
      const cleaned = (args ?? {}) as Record<string, unknown>;
      const text = await mcpRegistry.callTool(server, toolName, cleaned);
      return text || "(empty response from MCP tool)";
    },
  };
}
