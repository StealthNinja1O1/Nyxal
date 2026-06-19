// stats endpoints for the dashboard.
//
// GET /api/stats/overview          bot counts by status + token totals (today/week/month)
// GET /api/stats/usage?range=day   token usage buckets per hour/day for charts
// GET /api/logs?limit=&offset=     paginated recent logs (for the log viewer's
//                                  initial load if ws is down)

import { Elysia, t } from "elysia";
import { db } from "../../db";
import { bots, llmCallLog, logs } from "../../db/schema";
import { desc, asc, sql, and, eq, gte, sum } from "drizzle-orm";
import { botManager } from "../../bot/BotManager";

export const statsRoutes = new Elysia({ prefix: "/api" })
  .get("/stats/overview", async () => {
    const botRows = await db.select().from(bots);
    const statuses: Record<string, number> = {};
    for (const row of botRows) {
      const info = botManager.getStatus(row.id);
      const status = info?.status ?? (row.enabled ? "stopped" : "disabled");
      statuses[status] = (statuses[status] ?? 0) + 1;
    }

    // token totals over 3 windows
    const now = Date.now();
    const day = new Date(now - 24 * 60 * 60 * 1000);
    const week = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const month = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const agg = async (since: Date) => {
      const rows = await db
        .select({
          prompt: sum(llmCallLog.promptTokens),
          completion: sum(llmCallLog.completionTokens),
          total: sum(llmCallLog.totalTokens),
          calls: sql<number>`count(*)`,
        })
        .from(llmCallLog)
        .where(gte(llmCallLog.createdAt, since));
      const r = rows[0];
      return {
        prompt: Number(r?.prompt ?? 0),
        completion: Number(r?.completion ?? 0),
        total: Number(r?.total ?? 0),
        calls: Number(r?.calls ?? 0),
      };
    };

    return {
      bots: {
        total: botRows.length,
        statuses,
      },
      tokens: {
        day: await agg(day),
        week: await agg(week),
        month: await agg(month),
      },
    };
  })

  .get(
    "/stats/usage",
    async ({ query }) => {
      const range = query.range === "month" ? "month" : query.range === "week" ? "week" : "day";
      const hours = range === "month" ? 24 * 30 : range === "week" ? 24 * 7 : 24;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      // bucket size: day range = 1h, week = 6h, month = 1d (in seconds)
      const bucketSecs = range === "day" ? 3600 : range === "week" ? 6 * 3600 : 24 * 3600;
      // floor createdAt to the bucket boundary, sum tokens, group by bucket + botId
      const rows = await db
        .select({
          bucket: sql<number>`floor(${llmCallLog.createdAt} / 1000 / ${bucketSecs}) * ${bucketSecs}`,
          botId: llmCallLog.botId,
          prompt: sum(llmCallLog.promptTokens),
          completion: sum(llmCallLog.completionTokens),
          total: sum(llmCallLog.totalTokens),
          calls: sql<number>`count(*)`,
        })
        .from(llmCallLog)
        .where(gte(llmCallLog.createdAt, since))
        .groupBy(sql`floor(${llmCallLog.createdAt} / 1000 / ${bucketSecs})`, llmCallLog.botId);

      return {
        range,
        bucketSecs,
        buckets: rows.map((r) => ({
          ts: Number(r.bucket) * 1000,
          botId: r.botId,
          prompt: Number(r.prompt ?? 0),
          completion: Number(r.completion ?? 0),
          total: Number(r.total ?? 0),
          calls: Number(r.calls ?? 0),
        })),
      };
    },
    {
      query: t.Object({
        range: t.Optional(t.Union([t.Literal("day"), t.Literal("week"), t.Literal("month")])),
      }),
    },
  )

  .get(
    "/logs",
    async ({ query }) => {
      const limit = Math.min(Math.max(Number(query.limit ?? 200), 1), 1000);
      const offset = Math.max(Number(query.offset ?? 0), 0);

      const rows = await db
        .select()
        .from(logs)
        .orderBy(desc(logs.id))
        .limit(limit)
        .offset(offset);

      return {
        logs: rows.map((r) => ({
          id: r.id,
          botId: r.botId,
          level: r.level,
          scope: r.scope,
          message: r.message,
          createdAt: r.createdAt.getTime(),
        })),
        offset,
        limit,
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  );

export { asc, and, eq, bots };
