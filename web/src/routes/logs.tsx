// live log viewer with infinite backfill.
//
// - ws-connected: history restored on connect, new lines pushed live.
// - infinite scroll upward: when the user scrolls near the top, older rows
//   are fetched from /api/logs (cursor-paged by id) and prepended.
// - filters: level toggles, scope/bot dropdown, free-text search. all apply
//   to both the live stream and the backfilled history.
// - autoscroll to bottom on new lines unless the user scrolled up.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Filter, ArrowDownToLine, Trash2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { connectWs, recentLogs, setLogLevels, wsConnected, logLevels, type LogLevel } from "../lib/ws";
import { Button } from "../components/Button";
import {
  historyLogs,
  loadingMore,
  hasMore,
  loadMoreLogs,
  resetHistory,
} from "../state/logs";
import { bots, loadBots } from "../state/bots";

const LEVEL_TONE: Record<LogLevel, string> = {
  DEBUG: "log-level-debug",
  INFO: "log-level-info",
  WARN: "log-level-warn",
  ERROR: "log-level-error",
};

const ALL_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];

export function LogsRoute() {
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    connectWs();
    if (bots.value.length === 0) void loadBots();
  }, []);

  // autoscroll to the bottom when new lines arrive (if enabled).
  useEffect(() => {
    if (!autoscroll) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [recentLogs.value, autoscroll]);

  const prevScrollHeight = useRef<number | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || prevScrollHeight.current == null) return;
    const delta = el.scrollHeight - prevScrollHeight.current;
    el.scrollTop += delta;
    prevScrollHeight.current = null;
  }, [historyLogs.value]);

  // infinite scroll: trigger a backfill when the user is within almsot at top
  function onScroll() {
    const el = containerRef.current;
    if (!el) return;
    if (el.scrollTop < 200 && !loadingMore.value && hasMore.value) {
      prevScrollHeight.current = el.scrollHeight;
      void loadMoreLogs();
    }
  }

  const combined = useMemo(() => {
    return [...historyLogs.value, ...recentLogs.value];
  }, [historyLogs.value, recentLogs.value]);

  const visibleLogs = useMemo(() => {
    const levels = new Set(logLevels.value);
    const q = search.trim().toLowerCase();
    return combined.filter((l) => {
      if (!levels.has(l.level)) return false;
      if (scopeFilter === "__system__" && l.scope !== "system") return false;
      if (scopeFilter && scopeFilter !== "__system__" && l.scope !== scopeFilter && l.scope !== `bot:${scopeFilter}`) return false;
      if (q && !l.message.toLowerCase().includes(q) && !l.scope.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [combined, logLevels.value, search, scopeFilter]);

  function toggleLevel(level: LogLevel) {
    const set = new Set(logLevels.value);
    if (set.has(level)) set.delete(level);
    else set.add(level);
    setLogLevels([...set]);
  }

  function clearView() {
    recentLogs.value = [];
    resetHistory();
  }

  function jumpToNow() {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
          <button
            class={`log-level-toggle ${showFilters ? "active" : ""}`}
            onClick={() => setShowFilters((v) => !v)}
            title="More filters"
          >
            More {showFilters ? <ChevronUp size={11} style={{ verticalAlign: "middle" }} /> : <ChevronDown size={11} style={{ verticalAlign: "middle" }} />}
          </button>
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
          <Button variant="ghost" size="sm" onClick={jumpToNow} title="Jump to latest">
            Now
          </Button>
          <Button variant="ghost" size="sm" onClick={clearView}>
            <Trash2 size={14} />
            Clear view
          </Button>
        </div>
      </div>

      {showFilters && (
        <div class="logs-toolbar" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <div class="field" style={{ marginBottom: 0, minWidth: 240 }}>
            <label class="field-label" for="scope-filter">Scope / bot</label>
            <select
              id="scope-filter"
              class="field-input"
              value={scopeFilter}
              onChange={(e) => setScopeFilter((e.target as HTMLSelectElement).value)}
            >
              <option value="">(all scopes)</option>
              <option value="__system__">system</option>
              {bots.value.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <span class="field-hint" style={{ alignSelf: "flex-end", paddingBottom: 4 }}>
            Showing {visibleLogs.length} of {combined.length} loaded rows.
          </span>
        </div>
      )}

      <div class="logs-container" ref={containerRef} onScroll={onScroll}>
        {loadingMore.value && (
          <div class="logs-load-more">
            <Loader2 size={14} class="spin" />
            Loading older logs...
          </div>
        )}
        {!loadingMore.value && !hasMore.value && combined.length > 0 && (
          <div class="logs-load-more">Reached the beginning of the log.</div>
        )}
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
