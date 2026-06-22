// tool call log endpoints.
//
// GET /api/tool-calls          paginated, cursor-based (before id). filters:
//   ?botId=    filter to one bot
//   ?name=     filter to one tool name (generateImage, webSearch, ...)
//   ?kind=     instant | async | recursive
//   ?success=  true | false
//   ?q=        free-text search over args + error message
//   ?before=   id cursor (rows with id < before)
//   ?limit=    page size (default 100, max 500)

import { Elysia, t } from "elysia";
import { db } from "../../db";
import { toolCallLog, bots } from "../../db/schema";
import { desc, eq, lt, sql, and, like, or } from "drizzle-orm";

export const toolCallRoutes = new Elysia({ prefix: "/api/tool-calls" })
  .get("/names", async () => {
    const rows = await db.select({ name: toolCallLog.name }).from(toolCallLog).groupBy(toolCallLog.name);
    return rows.map((r) => r.name).sort();
  })

  .get(
    "/",
    async ({ query }) => {
      const limit = Math.min(Math.max(Number(query.limit ?? 100), 1), 500);
      const before = query.before ? Number(query.before) : null;

      const conds = [];
      if (query.botId) conds.push(eq(toolCallLog.botId, query.botId));
      if (query.name) conds.push(eq(toolCallLog.name, query.name));
      if (query.kind) conds.push(eq(toolCallLog.kind, query.kind));
      if (query.success === "true") conds.push(eq(toolCallLog.success, true));
      if (query.success === "false") conds.push(eq(toolCallLog.success, false));
      if (before != null && Number.isFinite(before)) conds.push(lt(toolCallLog.id, before));
      if (query.q) {
        const needle = `%${query.q}%`;

        conds.push(
          or(
            like(sql`CAST(${toolCallLog.args} AS TEXT)`, needle),
            like(toolCallLog.errorMessage, needle),
            like(toolCallLog.channelId, needle),
            like(toolCallLog.messageId, needle),
          ),
        );
      }

      const rows = await db
        .select({
          id: toolCallLog.id,
          botId: toolCallLog.botId,
          name: toolCallLog.name,
          kind: toolCallLog.kind,
          args: toolCallLog.args,
          success: toolCallLog.success,
          errorMessage: toolCallLog.errorMessage,
          ms: toolCallLog.ms,
          depth: toolCallLog.depth,
          channelId: toolCallLog.channelId,
          messageId: toolCallLog.messageId,
          createdAt: toolCallLog.createdAt,
        })
        .from(toolCallLog)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(toolCallLog.id))
        .limit(limit);

      const botRows = await db.select({ id: bots.id, name: bots.name }).from(bots);
      const botName = new Map(botRows.map((r) => [r.id, r.name]));

      const out = rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.getTime(),
        botName: botName.get(r.botId) ?? r.botId.slice(0, 8),
      }));

      return {
        calls: out,
        limit,
        oldestId: out.length > 0 ? out[out.length - 1]!.id : null,
        hasMore: out.length === limit,
      };
    },
    {
      query: t.Object({
        botId: t.Optional(t.String()),
        name: t.Optional(t.String()),
        kind: t.Optional(t.Union([t.Literal("instant"), t.Literal("async"), t.Literal("recursive")])),
        success: t.Optional(t.String()),
        q: t.Optional(t.String()),
        before: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  );
