// MCP server CRUD + tool discovery.
//
// GET    /api/mcp/servers              list servers with tool counts
// POST   /api/mcp/servers              create a server
// PATCH  /api/mcp/servers/:id          update name/url/headers
// DELETE /api/mcp/servers/:id          delete server + cascade its tools
// POST   /api/mcp/servers/:id/refetch  connect, listTools, upsert mcp_tools
// POST   /api/mcp/servers/:id/test     connect + ping, no DB write
// GET    /api/mcp/servers/:id/tools    list tools from DB (no live call)

import { Elysia, t } from "elysia";
import { db } from "../../db";
import { mcpServers, mcpTools, bots } from "../../db/schema";
import { eq } from "drizzle-orm";
import { botManager } from "../../bot/BotManager";
import { mcpRegistry, type McpServerRef } from "../../bot/mcp/McpRegistry";
import { newId, nowMs } from "../../db/ids";

function rowToServerRef(row: typeof mcpServers.$inferSelect): McpServerRef {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    headers: row.headers ?? {},
  };
}

async function toolCount(serverId: string): Promise<number> {
  const rows = await db.select().from(mcpTools).where(eq(mcpTools.serverId, serverId));
  return rows.length;
}

async function serverRowToPublic(row: typeof mcpServers.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    headers: row.headers ?? {},
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    lastFetchedAt: row.lastFetchedAt?.getTime() ?? null,
    lastFetchError: row.lastFetchError,
    toolCount: await toolCount(row.id),
  };
}

export const mcpRoutes = new Elysia({ prefix: "/api/mcp" })
  .get("/servers", async () => {
    const rows = await db.select().from(mcpServers).orderBy(mcpServers.createdAt);
    return Promise.all(rows.map(serverRowToPublic));
  })

  .post(
    "/servers",
    async ({ body }) => {
      const id = newId();
      const ts = new Date(nowMs());
      await db.insert(mcpServers).values({
        id,
        name: body.name,
        url: body.url,
        headers: body.headers ?? {},
        createdAt: ts,
        updatedAt: ts,
      });
      const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
      return serverRowToPublic(row!);
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        url: t.String({ minLength: 1 }),
        headers: t.Optional(t.Record(t.String(), t.String())),
      }),
    },
  )

  .patch(
    "/servers/:id",
    async ({ params, body, set }) => {
      const [existing] = await db.select().from(mcpServers).where(eq(mcpServers.id, params.id));
      if (!existing) {
        set.status = 404;
        return { error: "MCP server not found" };
      }
      const patch: Partial<typeof mcpServers.$inferInsert> = { updatedAt: new Date(nowMs()) };
      if (body.name !== undefined) patch.name = body.name;
      if (body.url !== undefined) patch.url = body.url;
      if (body.headers !== undefined) patch.headers = body.headers;

      // drop cached client so url/header changes force a reconnect.
      if (body.url !== undefined || body.headers !== undefined) {
        await mcpRegistry.disconnect(params.id);
      }

      await db.update(mcpServers).set(patch).where(eq(mcpServers.id, params.id));
      const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, params.id));
      return serverRowToPublic(row!);
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        url: t.Optional(t.String({ minLength: 1 })),
        headers: t.Optional(t.Record(t.String(), t.String())),
      }),
    },
  )

  .delete("/servers/:id", async ({ params, set }) => {
    const [existing] = await db.select().from(mcpServers).where(eq(mcpServers.id, params.id));
    if (!existing) {
      set.status = 404;
      return { error: "MCP server not found" };
    }
    await mcpRegistry.disconnect(params.id);
    // cascade delete removes mcp_tools rows. we also need to strip the id
    // from any bot that had it enabled so the registry refresh is consistent.
    const botRows = await db.select().from(bots);
    for (const bot of botRows) {
      const current = bot.mcpServerIds ?? [];
      if (current.includes(params.id)) {
        await db
          .update(bots)
          .set({ mcpServerIds: current.filter((x) => x !== params.id), updatedAt: new Date(nowMs()) })
          .where(eq(bots.id, bot.id));
      }
    }
    await db.delete(mcpServers).where(eq(mcpServers.id, params.id));

    // refresh any running bot that had this server
    await botManager.refreshMcpForServer(params.id).catch(() => {});
    return { ok: true };
  })

  .post("/servers/:id/refetch", async ({ params, set }) => {
    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, params.id));
    if (!row) {
      set.status = 404;
      return { error: "MCP server not found" };
    }

    const ref = rowToServerRef(row);
    try {
      await mcpRegistry.disconnect(params.id); // always reconnect fresh on refetch
      const tools = await mcpRegistry.listTools(ref);

      // replace the cached tool set for this server
      await db.delete(mcpTools).where(eq(mcpTools.serverId, params.id));
      if (tools.length > 0) {
        const now = new Date(nowMs());
        await db.insert(mcpTools).values(
          tools.map((tool) => ({
            serverId: params.id,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            updatedAt: now,
          })),
        );
      }

      await db
        .update(mcpServers)
        .set({
          lastFetchedAt: new Date(nowMs()),
          lastFetchError: null,
          updatedAt: new Date(nowMs()),
        })
        .where(eq(mcpServers.id, params.id));

      // refresh any running bot that uses this server
      await botManager.refreshMcpForServer(params.id).catch(() => {});

      return { ok: true, toolCount: tools.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .update(mcpServers)
        .set({ lastFetchError: msg, updatedAt: new Date(nowMs()) })
        .where(eq(mcpServers.id, params.id));
      set.status = 502;
      return { ok: false, error: msg };
    }
  })

  .post("/servers/:id/test", async ({ params, set }) => {
    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, params.id));
    if (!row) {
      set.status = 404;
      return { error: "MCP server not found" };
    }
    try {
      await mcpRegistry.disconnect(params.id);
      const tools = await mcpRegistry.listTools(rowToServerRef(row));
      return { ok: true, toolCount: tools.length };
    } catch (err) {
      set.status = 502;
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  })

  .get("/servers/:id/tools", async ({ params, set }) => {
    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, params.id));
    if (!row) {
      set.status = 404;
      return { error: "MCP server not found" };
    }
    const rows = await db
      .select()
      .from(mcpTools)
      .where(eq(mcpTools.serverId, params.id))
      .orderBy(mcpTools.name);
    return rows.map((t) => ({
      serverId: t.serverId,
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      updatedAt: t.updatedAt.getTime(),
    }));
  })

  // unauthenticated convenience: list all servers (lightweight, for the
  // bot Tools tab checkbox list). same shape as /servers.
  .get("/servers/list", async () => {
    const rows = await db.select().from(mcpServers).orderBy(mcpServers.name);
    return Promise.all(rows.map(serverRowToPublic));
  });
