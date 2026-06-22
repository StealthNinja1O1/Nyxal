// tool call history. infinite scroll downward

import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import { Fragment } from "preact";
import { Wrench, Loader2, ChevronDown, ChevronUp, Filter, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { toolCallsApi, type ToolCall, type ToolKind } from "../api/toolCalls";
import { bots, loadBots } from "../state/bots";
import { Button } from "../components/Button";
import { LoadingState, EmptyState } from "../components/State";

const PAGE_SIZE = 50;
const KIND_LABEL: Record<ToolKind, string> = {
  instant: "instant",
  async: "async",
  recursive: "recursive",
};

export function ToolCallsRoute() {
  const [calls, setCalls] = useState<ToolCall[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // filters
  const [botFilter, setBotFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | ToolKind>("");
  const [successFilter, setSuccessFilter] = useState<"" | "true" | "false">("");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // track the current filter signature
  const filterSig = `${botFilter}|${nameFilter}|${kindFilter}|${successFilter}|${search}`;

  const loadFirst = useCallback(async () => {
    setLoading(true);
    try {
      const page = await toolCallsApi.list({
        botId: botFilter || undefined,
        name: nameFilter || undefined,
        kind: kindFilter || undefined,
        success: successFilter === "" ? undefined : successFilter === "true",
        q: search || undefined,
        limit: PAGE_SIZE,
      });
      setCalls(page.calls);
      setHasMore(page.hasMore);
    } finally {
      setLoading(false);
    }
  }, [botFilter, nameFilter, kindFilter, successFilter, search]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || calls.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = calls[calls.length - 1]!.id;
      const page = await toolCallsApi.list({
        botId: botFilter || undefined,
        name: nameFilter || undefined,
        kind: kindFilter || undefined,
        success: successFilter === "" ? undefined : successFilter === "true",
        q: search || undefined,
        before: oldest,
        limit: PAGE_SIZE,
      });
      setCalls((prev) => [...prev, ...page.calls]);
      setHasMore(page.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, calls, botFilter, nameFilter, kindFilter, successFilter, search]);

  useEffect(() => {
    void loadFirst();
    void toolCallsApi.names().then(setNames).catch(() => {});
    if (bots.value.length === 0) void loadBots();
  }, [filterSig]); // re-fetch when any filter changes

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section>
      <div class="list-card">
        <div class="list-header">
          <h2>
            Tool calls
          </h2>
          <div style={{ display: "flex", gap: 6 }}>
            <Button variant="ghost" size="sm" onClick={() => void loadFirst()} disabled={loading} title="Reload">
              <RefreshCw size={14} class={loading ? "spin" : ""} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowFilters((v) => !v)}>
              <Filter size={14} />
              Filters
              {showFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </Button>
          </div>
        </div>

        {showFilters && (
          <div class="logs-toolbar" style={{ borderRadius: 0, borderBottom: "1px solid var(--border)" }}>
            <select class="field-input" style={{ width: "auto" }} value={botFilter} onChange={(e) => setBotFilter((e.target as HTMLSelectElement).value)}>
              <option value="">(all bots)</option>
              {bots.value.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <select class="field-input" style={{ width: "auto" }} value={nameFilter} onChange={(e) => setNameFilter((e.target as HTMLSelectElement).value)}>
              <option value="">(all tools)</option>
              {names.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <select class="field-input" style={{ width: "auto" }} value={kindFilter} onChange={(e) => setKindFilter((e.target as HTMLSelectElement).value as "" | ToolKind)}>
              <option value="">(all kinds)</option>
              <option value="instant">instant</option>
              <option value="async">async</option>
              <option value="recursive">recursive</option>
            </select>
            <select class="field-input" style={{ width: "auto" }} value={successFilter} onChange={(e) => setSuccessFilter((e.target as HTMLSelectElement).value as "" | "true" | "false")}>
              <option value="">(any status)</option>
              <option value="true">success only</option>
              <option value="false">failed only</option>
            </select>
            <input
              class="logs-search"
              type="search"
              placeholder="Search args, errors, Discord IDs..."
              value={search}
              onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            />
          </div>
        )}

        {loading ? (
          <LoadingState label="Loading tool calls..." />
        ) : calls.length === 0 ? (
          <EmptyState
            icon={<Wrench size={32} />}
            title="No tool calls yet"
            subtitle="When a bot runs a command (generateImage, webSearch, react, ...), it shows up here with the full arguments."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table class="data-table tool-call-table">
              <thead>
                <tr>
                  <th style={{ width: 1 }}></th>
                  <th>Time</th>
                  <th>Bot</th>
                  <th>Tool</th>
                  <th>Kind</th>
                  <th>Args</th>
                  <th>ms</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => {
                  const isOpen = expanded.has(c.id);
                  const argPreview = formatArgsPreview(c.args);
                  return (
                    <Fragment key={c.id}>
                      <tr onClick={() => toggleExpand(c.id)}>
                        <td style={{ cursor: "pointer", color: "var(--text-faint)" }}>
                          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </td>
                        <td class="col-mono">{new Date(c.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                        <td>{c.botName}</td>
                        <td class="col-mono"><strong>{c.name}</strong></td>
                        <td>
                          <span class={`badge badge-${c.kind === "async" ? "accent" : c.kind === "recursive" ? "info" : "neutral"}`}>{KIND_LABEL[c.kind]}</span>
                        </td>
                        <td class="col-mono" style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{argPreview}</td>
                        <td class="col-mono">{c.ms}ms</td>
                        <td>
                          {c.success ? (
                            <CheckCircle2 size={15} style={{ color: "var(--ok)", verticalAlign: "middle" }} />
                          ) : (
                            <XCircle size={15} style={{ color: "var(--err)", verticalAlign: "middle" }} />
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr class="tool-call-detail-row">
                          <td colSpan={8}>
                            <div class="tool-call-detail">
                              <div class="tool-call-detail-section">
                                <div class="tool-call-detail-label">Arguments</div>
                                <pre class="tool-call-json">{JSON.stringify(c.args, null, 2)}</pre>
                              </div>
                              {c.errorMessage && (
                                <div class="tool-call-detail-section">
                                  <div class="tool-call-detail-label" style={{ color: "var(--err)" }}>Error</div>
                                  <pre class="tool-call-json tool-call-json-error">{c.errorMessage}</pre>
                                </div>
                              )}
                              <div class="tool-call-detail-meta">
                                {c.channelId && <span>channel: <code>{c.channelId}</code></span>}
                                {c.depth > 0 && <span>depth: {c.depth}</span>}
                                {c.messageId && <span>message: <code>{c.messageId}</code></span>}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>

            {hasMore ? (
              <div style={{ padding: 16, textAlign: "center" }}>
                <Button variant="subtle" size="sm" onClick={loadMore} loading={loadingMore} disabled={loadingMore}>
                  Load more
                </Button>
              </div>
            ) : (
              <div class="logs-empty" style={{ padding: 16 }}>
                <p style={{ margin: 0 }}>End of results ({calls.length} shown).</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function formatArgsPreview(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string") {
      // truncate long strings (e.g. prompts) for the preview row
      const shown = v.length > 80 ? v.slice(0, 77) + "..." : v;
      parts.push(`${k}: "${shown}"`);
    } else {
      parts.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  return parts.length === 0 ? "(no args)" : parts.join(", ");
}
