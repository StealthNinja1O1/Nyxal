// dashboard overview.
// top: stat strip (today / week / month tokens) + a big interactive usage chart.
// below: left col = recently active bots + live llm call feed, right col = system widget.

import { useEffect, useState } from "preact/hooks";
import { Link } from "wouter";
import { Bot, Zap } from "lucide-react";
import { bots, loadBots } from "../state/bots";
import { StatusBadge } from "../components/StatusBadge";
import { statsApi, type OverviewStats, type UsageBucket } from "../api/stats";
import { liveLlmCalls, connectWs } from "../lib/ws";
import { LoadingState } from "../components/State";
import { UsageChart } from "../components/UsageChart";
import { SystemWidget } from "../components/SystemWidget";

type Range = "day" | "week" | "month";

export function OverviewRoute() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [range, setRange] = useState<Range>("day");
  const [buckets, setBuckets] = useState<UsageBucket[]>([]);
  const [bucketSecs, setBucketSecs] = useState(3600);

  async function loadOverview() {
    setOverview(await statsApi.overview());
  }
  async function loadUsage() {
    const u = await statsApi.usage(range);
    setBuckets(u.buckets);
    setBucketSecs(u.bucketSecs);
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
    <div class="overview-stack">
      {/* stat strip */}
      {!overview ? (
        <LoadingState label="Loading stats..." />
      ) : (
        <div class="stat-strip">
          <StatTile label="Today" data={overview.tokens.day} />
          <StatTile label="This week" data={overview.tokens.week} />
          <StatTile label="This month" data={overview.tokens.month} />
        </div>
      )}

      {/* usage chart */}
      <div>
        <div class="section-head">
          <h2>Token usage</h2>
          <div class="range-toggle">
            {(["day", "week", "month"] as Range[]).map((r) => (
              <button
                key={r}
                class={`range-btn ${range === r ? "active" : ""}`}
                onClick={() => setRange(r)}
              >
                {r === "day" ? "24h" : r === "week" ? "7d" : "30d"}
              </button>
            ))}
          </div>
        </div>
        <UsageChart buckets={buckets} bucketSecs={bucketSecs} />
      </div>

      {/* lower grid: recent activity + system widget */}
      <div class="overview-grid">
        <section class="overview-col">
          <div class="section-head">
            <h2>Recently active bots</h2>
          </div>
          {!overview ? (
            <LoadingState label="Loading..." />
          ) : overview.recentBots.length === 0 ? (
            <p class="field-hint">No bots yet - create one on the Bots page.</p>
          ) : (
            overview.recentBots.map((b) => (
              <Link key={b.id} href={`/bots/${b.id}`}>
                <div class="recent-bot-row">
                  <Bot size={14} style={{ color: "var(--accent)" }} />
                  <span class="recent-bot-name">{b.name}</span>
                  <StatusBadge status={b.status as never} />
                  <span class="recent-bot-activity">
                    {b.lastCallAt ? relativeTime(b.lastCallAt) : "never"}
                  </span>
                </div>
              </Link>
            ))
          )}

          <div class="section-head" style={{ marginTop: 20 }}>
            <h2>Recent LLM calls</h2>
          </div>
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
          <div class="section-head">
            <h2>System</h2>
          </div>
          <SystemWidget />
        </section>
      </div>
    </div>
  );
}

function StatTile({
  label,
  data,
}: {
  label: string;
  data: OverviewStats["tokens"]["day"];
}) {
  return (
    <div class="stat-tile">
      <span class="stat-tile-accent-bar" />
      <span class="stat-tile-label">{label}</span>
      <span class="stat-tile-value">{fmtTokens(data.total)}</span>
      <span class="stat-tile-meta">{data.calls} call{data.calls === 1 ? "" : "s"}</span>
      <div class="stat-tile-split">
        <span class="prompt">↑ {fmtTokens(data.prompt)}</span>
        <span class="completion">↓ {fmtTokens(data.completion)}</span>
      </div>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
