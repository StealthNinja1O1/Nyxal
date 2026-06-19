// resolve enabled MCP servers + their tools for a bot, returning CommandDefs
// ready to register.

import { db } from "../../db";
import { mcpServers, mcpTools } from "../../db/schema";
import { inArray } from "drizzle-orm";
import type { CommandDef } from "../commands/registry";
import { buildMcpCommandDef } from "./mcpCommands";
import type { McpServerRef } from "./McpRegistry";

function rowToServerRef(row: typeof mcpServers.$inferSelect): McpServerRef {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    headers: row.headers ?? {},
  };
}

/** Load CommandDefs for every tool on every enabled server for this bot. */
export async function loadMcpCommandDefs(mcpServerIds: string[]): Promise<{
  defs: CommandDef[];
  servers: McpServerRef[];
}> {
  if (mcpServerIds.length === 0) return { defs: [], servers: [] };

  const serverRows = await db
    .select()
    .from(mcpServers)
    .where(inArray(mcpServers.id, mcpServerIds));
  if (serverRows.length === 0) return { defs: [], servers: [] };

  const toolRows = await db
    .select()
    .from(mcpTools)
    .where(inArray(mcpTools.serverId, serverRows.map((s) => s.id)));

  const servers = serverRows.map(rowToServerRef);
  const defs: CommandDef[] = [];
  for (const server of servers) {
    const tools = toolRows.filter((t) => t.serverId === server.id);
    for (const tool of tools) {
      defs.push(
        buildMcpCommandDef(server, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }),
      );
    }
  }
  return { defs, servers };
}
