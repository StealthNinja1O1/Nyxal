// dashboard overview. bot status grid + token totals (today/week/month) +
// a usage chart fed by the /stats/usage endpoint + live llm call feed.

import { useEffect, useState } from "preact/hooks";
import { Link } from "wouter";
import { Bot, Zap, Activity, Cpu, ArrowRight } from "lucide-react";
import { bots, loadBots } from "../state/bots";
import { StatusBadge } from "../components/StatusBadge";
import { statsApi, type OverviewStats, type UsageBucket } from "../api/stats";
import { liveLlmCalls, connectWs } from "../lib/ws";
import { Button } from "../components/Button";
import { LoadingState, EmptyState } from "../components/State";

type Range = "day" | "week" | "month";

export function OverviewRoute() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [range, setRange] = useState<Range>("day");
  const [buckets, setBuckets] = useState<UsageBucket[]>([]);

  async function loadOverview() {
    setOverview(await statsApi.overview());
  }
  async function loadUsage() {
    const u = await statsApi.usage(range);
    setBuckets(aggregateBuckets(u.buckets));
  }

  useEffect(() => {
    void loadOverview();
    void loadUsage();
    if (bots.value.length === 0) void loadBots();
    connectWs();
  }, []);

  useEffect(() => {
    void loadUsage();
  }, [range]);

  return (
    <div class="overview-grid">
      <section class="overview-col">
        <h2 class="overview-heading">Bots</h2>
        {bots.value.length === 0 ? (
          <LoadingState label="Loading bots..." />
        ) : (
          <div class="overview-bot-grid">
            {bots.value.map((b) => (
              <Link key={b.id} href={`/bots/${b.id}`}>
                <div class="overview-bot-card">
                  <div class="overview-bot-top">
                    <Bot size={16} />
                    <span class="overview-bot-name">{b.name}</span>
                  </div>
                  <StatusBadge status={b.status} detail={b.detail} />
                  <div class="overview-bot-model">{b.llmModel || "no model"}</div>
                </div>
              </Link>
            ))}
          </div>
        )}

        <h2 class="overview-heading" style={{ marginTop: 24 }}>Recent LLM calls</h2>
        <div class="overview-call-list">
          {liveLlmCalls.value.length === 0 ? (
            <p class="field-hint">Live LLM calls will appear here as the bots make them.</p>
          ) : (
            liveLlmCalls.value.slice(-12).reverse().map((c, i) => (
              <div key={i} class={`call-row ${c.success ? "" : "failed"}`}>
                <Zap size={12} />
                <span class="call-model">{c.model}</span>
                <span class="call-tokens">{c.totalTokens} tok</span>
                <span class="call-ms">{(c.ms / 1000).toFixed(1)}s</span>
                {!c.success && <span class="call-fail">failed</span>}
              </div>
            ))
          )}
        </div>
      </section>

      <section class="overview-col">
        <h2 class="overview-heading">Token usage</h2>
        {!overview ? (
          <LoadingState label="Loading stats..." />
        ) : (
          <>
            <div class="token-cards">
              <TokenCard label="Today" data={overview.tokens.day} />
              <TokenCard label="Week" data={overview.tokens.week} />
              <TokenCard label="Month" data={overview.tokens.month} />
            </div>

            <div class="usage-chart-wrap">
              <div class="usage-chart-header">
                <span>Usage over time</span>
                <div class="range-toggle">
                  {(["day", "week", "month"] as Range[]).map((r) => (
                    <button
                      key={r}
                      class={`range-btn ${range === r ? "active" : ""}`}
                      onClick={() => setRange(r)}
                    >
                      {r[0]!.toUpperCase() + r.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <UsageChart buckets={buckets} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function TokenCard({ label, data }: { label: string; data: OverviewStats["tokens"]["day"] }) {
  return (
    <div class="token-card">
      <div class="token-card-label">{label}</div>
      <div class="token-card-value">{fmtTokens(data.total)}</div>
      <div class="token-card-meta">{data.calls} calls</div>
      <div class="token-card-split">
        <span class="prompt">↑ {fmtTokens(data.prompt)}</span>
        <span class="completion">↓ {fmtTokens(data.completion)}</span>
      </div>
    </div>
  );
}

/** roll per-bot buckets up to per-bucket totals (so the chart has one bar per time slot). */
function aggregateBuckets(buckets: UsageBucket[]): { ts: number; total: number; calls: number }[] {
  const byTs = new Map<number, { total: number; calls: number }>();
  for (const b of buckets) {
    const cur = byTs.get(b.ts) ?? { total: 0, calls: 0 };
    cur.total += b.total;
    cur.calls += b.calls;
    byTs.set(b.ts, cur);
  }
  return [...byTs.entries()]
    .map(([ts, v]) => ({ ts, ...v }))
    .sort((a, b) => a.ts - b.ts);
}

function UsageChart({ buckets }: { buckets: { ts: number; total: number; calls: number }[] }) {
  if (buckets.length === 0) {
    return (
      <div class="usage-empty">
        <Activity size={20} />
        <p>No usage data yet for this range.</p>
        <p class="field-hint">As bots make LLM calls, token usage gets bucketed here.</p>
      </div>
    );
  }

  const max = Math.max(...buckets.map((b) => b.total), 1);
  const w = 100; // viewBox width %
  const chartHeight = 120;
  const barW = w / buckets.length;

  return (
    <div class="usage-chart">
      <svg viewBox={`0 0 ${w} ${chartHeight}`} preserveAspectRatio="none" class="usage-svg">
        {buckets.map((b, i) => {
          const h = (b.total / max) * (chartHeight - 16);
          const x = i * barW;
          const y = chartHeight - h;
          return <rect key={i} x={x + 0.5} y={y} width={Math.max(barW - 1, 0.5)} height={h} rx={0.5} class="usage-bar" />;
        })}
      </svg>
      <div class="usage-axis">
        <span>{fmtTime(buckets[0]!.ts)}</span>
        <span>{fmtTime(buckets[buckets.length - 1]!.ts)}</span>
      </div>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
