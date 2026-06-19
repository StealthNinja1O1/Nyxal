// live log viewer. ws-connected: history restored on connect, new lines pushed
// live, level filter applied both client-side (instant) and server-side (saves
// bandwidth). auto-scrolls to the bottom on new lines unless the user scrolled up.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Filter, ArrowDownToLine, Trash2 } from "lucide-react";
import { connectWs, recentLogs, setLogLevels, wsConnected, logLevels, type LogLevel } from "../lib/ws";
import { Button } from "../components/Button";

const LEVEL_TONE: Record<LogLevel, string> = {
  DEBUG: "log-level-debug",
  INFO: "log-level-info",
  WARN: "log-level-warn",
  ERROR: "log-level-error",
};

const ALL_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];

export function LogsRoute() {
  const [search, setSearch] = useState("");
  const [autoscroll, setAutoscroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    connectWs();
  }, []);

  // autoscroll to the bottom when new lines arrive (if enabled)
  useEffect(() => {
    if (!autoscroll) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [recentLogs.value, autoscroll]);

  const visibleLogs = useMemo(() => {
    const levels = new Set(logLevels.value);
    const q = search.trim().toLowerCase();
    return recentLogs.value.filter((l) => {
      if (!levels.has(l.level)) return false;
      if (q && !l.message.toLowerCase().includes(q) && !l.scope.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [recentLogs.value, logLevels.value, search]);

  function toggleLevel(level: LogLevel) {
    const set = new Set(logLevels.value);
    if (set.has(level)) set.delete(level);
    else set.add(level);
    setLogLevels([...set]);
  }

  function clearView() {
    // local-only clear (the ws keeps streaming new lines after)
    recentLogs.value = [];
  }

  return (
    <section class="logs-route">
      <div class="logs-toolbar">
        <div class="logs-filter-group">
          <Filter size={14} />
          {ALL_LEVELS.map((lvl) => (
            <button
              key={lvl}
              class={`log-level-toggle ${LEVEL_TONE[lvl]} ${
                logLevels.value.includes(lvl) ? "active" : ""
              }`}
              onClick={() => toggleLevel(lvl)}
            >
              {lvl}
            </button>
          ))}
        </div>

        <input
          class="logs-search"
          type="search"
          placeholder="Search logs..."
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        />

        <div class="logs-toolbar-right">
          <span class={`ws-status ${wsConnected.value ? "on" : "off"}`}>
            <span class="ws-dot" />
            {wsConnected.value ? "live" : "reconnecting..."}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoscroll((v) => !v)}
            aria-pressed={autoscroll}
          >
            <ArrowDownToLine size={14} />
            {autoscroll ? "Auto" : "Manual"}
          </Button>
          <Button variant="ghost" size="sm" onClick={clearView}>
            <Trash2 size={14} />
            Clear view
          </Button>
        </div>
      </div>

      <div class="logs-container" ref={containerRef}>
        {visibleLogs.length === 0 ? (
          <div class="logs-empty">
            <p>No log lines match the current filter.</p>
            <p class="field-hint">
              Connect a bot, send it a message, and watch its log lines stream in here.
            </p>
          </div>
        ) : (
          visibleLogs.map((l) => (
            <div key={`${l.id ?? l.createdAt}-${l.scope}-${l.message.slice(0, 20)}`} class="log-line">
              <span class="log-ts">{new Date(l.createdAt).toLocaleTimeString(undefined, { hour12: false })}</span>
              <span class={`log-level ${LEVEL_TONE[l.level]}`}>{l.level}</span>
              <span class="log-scope">{l.scope || "-"}</span>
              <span class="log-message">{l.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
