// system stats widget. polls /api/stats/system every ~5s


import { useEffect, useState } from "preact/hooks";
import { Cpu, MemoryStick, Server, Clock } from "lucide-react";
import { statsApi, type SystemStats } from "../api/stats";

export function SystemWidget() {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = await statsApi.system();
        if (!cancelled) setStats(s);
      } catch {
        // ignore - next tick will retry
      }
    }
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!stats) {
    return (
      <div class="sys-grid">
        <div class="sys-metric">
          <span class="sys-metric-label">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div class="sys-grid">
      <Metric
        icon={<Cpu size={13} />}
        label="Process CPU"
        value={`${stats.process.cpuPercent.toFixed(1)}%`}
        sub={`${stats.system.cores} core${stats.system.cores === 1 ? "" : "s"} total`}
      />
      <Metric
        icon={<Cpu size={13} />}
        label="System CPU"
        value={`${stats.system.cpuPercent.toFixed(1)}%`}
        sub="across all cores"
      />
      <Metric
        icon={<MemoryStick size={13} />}
        label="Process RAM"
        value={fmtBytes(stats.process.rss)}
        sub={`heap ${fmtBytes(stats.process.heapUsed)} / ${fmtBytes(stats.process.heapTotal)}`}
      />
      <Metric
        icon={<Server size={13} />}
        label="System RAM"
        value={fmtBytes(stats.system.usedMem)}
        sub={`of ${fmtBytes(stats.system.totalMem)} - ${fmtBytes(stats.system.freeMem)} free`}
      />
      <Metric
        icon={<Clock size={13} />}
        label="Uptime"
        value={fmtUptime(stats.process.uptimeSec)}
        sub="since process start"
      />
      <Metric
        icon={<MemoryStick size={13} />}
        label="DB size"
        value={fmtBytes(stats.db.sizeBytes)}
        sub={shortPath(stats.db.path)}
      />
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  sub,
}: {
  icon: preact.ComponentChildren;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div class="sys-metric">
      <span class="sys-metric-label">
        {icon}
        {label}
      </span>
      <span class="sys-metric-value">{value}</span>
      {sub && <span class="sys-metric-sub">{sub}</span>}
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtUptime(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

function shortPath(p: string): string {
  if (p.length <= 32) return p;
  return "..." + p.slice(-29);
}
