// stats endpoints for the dashboard.
//
// GET /api/stats/overview          bot counts by status + token totals
// GET /api/stats/usage?range=day   token usage buckets per hour/day for charts
// GET /api/logs?limit=&offset=     paginated recent logs

import { Elysia, t } from "elysia";
import { db } from "../../db";
import { bots, llmCallLog, logs } from "../../db/schema";
import { desc, asc, sql, and, eq, gte, lt, sum } from "drizzle-orm";
import { botManager } from "../../bot/BotManager";
import { dbPath } from "../../db";
import os from "os";
import { statSync } from "fs";

interface CpuSample {
  wallMs: number;
  procUserUs: number;
  procSysUs: number;
  sysIdleMs: number;
  sysTotalMs: number;
}
let lastSample: CpuSample | null = null;

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
      recentBots: await recentBots(6),
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
      const bucketMs = bucketSecs * 1000;
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

      const byTs = new Map<number, { total: number; prompt: number; completion: number; calls: number }>();
      for (const r of rows) {
        const ts = Number(r.bucket) * 1000;
        const cur = byTs.get(ts) ?? { total: 0, prompt: 0, completion: 0, calls: 0 };
        cur.total += Number(r.total ?? 0);
        cur.prompt += Number(r.prompt ?? 0);
        cur.completion += Number(r.completion ?? 0);
        cur.calls += Number(r.calls ?? 0);
        byTs.set(ts, cur);
      }

      const now = Date.now();
      const bucketsPerHour = bucketSecs / 3600;
      const totalBuckets = Math.round(hours / bucketsPerHour);
      const out: { ts: number; total: number; prompt: number; completion: number; calls: number }[] = [];
      for (let i = totalBuckets; i > 0; i--) {
        const ts = Math.floor((now - i * bucketMs) / bucketMs) * bucketMs;
        const v = byTs.get(ts);
        out.push({
          ts,
          total: v?.total ?? 0,
          prompt: v?.prompt ?? 0,
          completion: v?.completion ?? 0,
          calls: v?.calls ?? 0,
        });
      }

      return { range, bucketSecs, buckets: out };
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
      const before = query.before ? Number(query.before) : null;
      const offset = before == null ? Math.max(Number(query.offset ?? 0), 0) : 0;

      const base = db.select().from(logs).$dynamic();
      if (before != null && Number.isFinite(before)) base.where(lt(logs.id, before));
      const rows = await base.orderBy(desc(logs.id)).limit(limit).offset(offset);

      const oldest = rows.length > 0 ? rows[rows.length - 1]!.id : null;
      const newest = rows.length > 0 ? rows[0]!.id : null;

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
        oldestId: oldest,
        newestId: newest,
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        before: t.Optional(t.String()),
      }),
    },
  )

  .get("/stats/system", async () => {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const uptime = process.uptime();
    const now = Date.now();

    const cpus = os.cpus();
    let sysIdleMs = 0;
    let sysTotalMs = 0;
    for (const c of cpus) {
      const t = c.times;
      sysTotalMs += t.user + t.nice + t.sys + t.irq + t.idle;
      sysIdleMs += t.idle;
    }

    const sample: CpuSample = {
      wallMs: now,
      procUserUs: cpu.user,
      procSysUs: cpu.system,
      sysIdleMs,
      sysTotalMs,
    };

    let procCpuPercent = 0;
    let sysCpuPercent = 0;
    if (lastSample) {
      const wallDeltaMs = Math.max(now - lastSample.wallMs, 1);
      const procDeltaUs = (cpu.user - lastSample.procUserUs) + (cpu.system - lastSample.procSysUs);
      procCpuPercent = clamp((procDeltaUs / 1000 / wallDeltaMs) * 100, 0, 100 * cpus.length);

      const sysDeltaTotal = Math.max(sysTotalMs - lastSample.sysTotalMs, 1);
      const sysDeltaIdle = sysIdleMs - lastSample.sysIdleMs;
      const sysBusyFrac = Math.max(0, Math.min(1, 1 - sysDeltaIdle / sysDeltaTotal));
      sysCpuPercent = clamp(sysBusyFrac * 100, 0, 100);
    }
    lastSample = sample;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cores = cpus.length;

    let dbSize = 0;
    try {
      dbSize = statSync(dbPath).size;
    } catch {
      dbSize = 0;
    }

    return {
      process: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        uptimeSec: uptime,
        cpuPercent: procCpuPercent,
      },
      system: {
        totalMem,
        freeMem,
        usedMem,
        cores,
        cpuPercent: sysCpuPercent,
      },
      db: {
        path: dbPath,
        sizeBytes: dbSize,
      },
    };
  });

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

async function recentBots(limit: number) {
  // latest call per bot
  const lastCalls = await db
    .select({
      botId: llmCallLog.botId,
      lastCall: sql<number>`max(${llmCallLog.createdAt})`.as("last_call"),
      totalTokens: sum(llmCallLog.totalTokens),
    })
    .from(llmCallLog)
    .groupBy(llmCallLog.botId);
  const lastCallByBot = new Map(lastCalls.map((r) => [r.botId, { lastCall: Number(r.lastCall), totalTokens: Number(r.totalTokens ?? 0) }]));

  const rows = await db.select().from(bots);
  const ranked = rows
    .map((r) => {
      const info = botManager.getStatus(r.id);
      const lc = lastCallByBot.get(r.id);
      return {
        id: r.id,
        name: r.name,
        status: info?.status ?? (r.enabled ? "stopped" : "disabled"),
        model: r.llmModel,
        lastCallAt: lc?.lastCall ?? null,
        totalTokens: lc?.totalTokens ?? 0,
        createdAt: r.createdAt.getTime(),
      };
    })
    .sort((a, b) => (b.lastCallAt ?? b.createdAt) - (a.lastCallAt ?? a.createdAt))
    .slice(0, limit);

  return ranked;
}

export { asc, and, eq, bots };
