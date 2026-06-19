// interactive SVG usage chart with hover tooltips.
//
// props:
//   buckets  - { ts, total, prompt, completion, calls }[]
//   bucketSecs - the server's bucket size, used to format the x-axis labels
//   emptyHint - shown when buckets is empty

import { useRef, useState, useEffect } from "preact/hooks";
import { Activity } from "lucide-react";

export interface ChartBucket {
  ts: number;
  total: number;
  prompt: number;
  completion: number;
  calls: number;
}

interface Props {
  buckets: ChartBucket[];
  bucketSecs: number;
}

const CHART_H = 220;
const PAD_X = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 22;

export function UsageChart({ buckets, bucketSecs }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // measure available width so bars don't get squashed on narrow screens
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 640;
      setWidth(Math.max(280, Math.floor(w)));
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  if (buckets.length === 0) {
    return (
      <div class="usage-empty">
        <Activity size={20} />
        <p>No usage data yet for this range.</p>
        <p class="field-hint">As bots make LLM calls, token usage gets bucketed here.</p>
      </div>
    );
  }

  const innerW = Math.max(width - PAD_X * 2, 1);
  const innerH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const max = Math.max(...buckets.map((b) => b.total), 1);
  const barSlot = innerW / buckets.length;
  const barW = Math.max(barSlot * 0.7, 1);

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const hovered = hoverIdx != null ? buckets[hoverIdx] : null;

  return (
    <div class="usage-chart-wrap interactive">
      <div
        ref={wrapRef}
        class="usage-chart interactive"
        onMouseMove={(e) => {
          const svg = (e.currentTarget as HTMLDivElement).querySelector("svg");
          const rect = (svg ?? e.currentTarget).getBoundingClientRect();
          if (rect.width === 0) return;
          const x = e.clientX - rect.left;
          const innerRatio = (rect.width - PAD_X * 2) / rect.width;
          const frac = (x / rect.width - PAD_X / rect.width) / innerRatio;
          const idx = Math.floor(frac * buckets.length);
          setHoverIdx(idx >= 0 && idx < buckets.length ? idx : null);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <svg
          class="usage-svg interactive"
          width={width}
          height={CHART_H}
          viewBox={`0 0 ${width} ${CHART_H}`}
        >
          {/* horizontal gridlines */}
          {ticks.map((t) => {
            const y = PAD_TOP + innerH - t * innerH;
            return (
              <g key={t}>
                <line
                  x1={PAD_X}
                  x2={width - PAD_X}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth={1}
                  opacity={0.5}
                />
                <text
                  x={width - PAD_X + 2}
                  y={y + 3}
                  fontSize={9}
                  fill="var(--text-faint)"
                  fontFamily="var(--mono)"
                  textAnchor="start"
                >
                  {fmtTokens(max * t)}
                </text>
              </g>
            );
          })}

          {/* hover guide line */}
          {hoverIdx != null && (
            <line
              class="usage-hover-line"
              x1={PAD_X + hoverIdx * barSlot + barSlot / 2}
              x2={PAD_X + hoverIdx * barSlot + barSlot / 2}
              y1={PAD_TOP}
              y2={PAD_TOP + innerH}
            />
          )}

          {/* bars */}
          {buckets.map((b, i) => {
            const h = (b.total / max) * innerH;
            const x = PAD_X + i * barSlot + (barSlot - barW) / 2;
            const y = PAD_TOP + innerH - h;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, b.total > 0 ? 1 : 0)}
                rx={1}
                class={`usage-bar-interactive ${hoverIdx === i ? "is-hover" : ""}`}
              />
            );
          })}

          {/* x axis labels: start + middle + end */}
          {[0, Math.floor(buckets.length / 2), buckets.length - 1].map((i, k) => (
            <text
              key={k}
              x={PAD_X + i * barSlot + barSlot / 2}
              y={CHART_H - 6}
              fontSize={9}
              fill="var(--text-faint)"
              fontFamily="var(--mono)"
              textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
            >
              {fmtAxis(buckets[i]!.ts, bucketSecs)}
            </text>
          ))}
        </svg>

        {/* hover tooltip */}
        {hovered && hoverIdx != null && (
          <div
            class="usage-tooltip"
            style={{
              left: `calc(${((hoverIdx + 0.5) / buckets.length) * 100}% )`,
              top: PAD_TOP + 8,
            }}
          >
            <div>{fmtAxis(hovered.ts, bucketSecs)}</div>
            <div class="usage-tooltip-meta">
              <strong>{fmtTokens(hovered.total)}</strong> tokens
              {hovered.calls > 0 ? ` - ${hovered.calls} call${hovered.calls === 1 ? "" : "s"}` : ""}
            </div>
            {hovered.total > 0 && (
              <div class="usage-tooltip-meta">
                <span style={{ color: "var(--info)" }}>↑ {fmtTokens(hovered.prompt)}</span>
                {"  "}
                <span style={{ color: "var(--ok)" }}>↓ {fmtTokens(hovered.completion)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtAxis(ts: number, bucketSecs: number): string {
  const d = new Date(ts);
  if (bucketSecs >= 24 * 3600) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
