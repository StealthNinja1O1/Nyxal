// per-bot tools tab. shows every builtin command + every enabled MCP server's
// tools with toggle + collapsible description override. the override state
// lives in bots.tool_overrides, MCP server selection in bots.mcp_server_ids.

import { useEffect, useState, useCallback } from "preact/hooks";
import { ChevronDown, ChevronRight, Save, RotateCcw, Plug, Plug2, RefreshCw } from "lucide-react";
import { botsApi } from "../../api/bots";
import { Link } from "wouter";
import type { ToolOverride, ToolOverrides } from "@shared/types";
import { updateBot } from "../../state/bots";
import { Toggle } from "../../components/Toggle";
import { TextArea } from "../../components/TextArea";
import { LoadingState, EmptyState } from "../../components/State";
import { toast } from "../../state/toast";

interface BotTool {
  name: string;
  kind: "instant" | "async" | "recursive";
  category: "builtin" | "websearch" | "comfyui" | "mcp";
  args: Record<string, unknown>;
  description: string;
  defaultEnabled: boolean;
  effectiveEnabled: boolean;
  override?: ToolOverride;
}
interface BotMcpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastFetchedAt: number | null;
  lastFetchError: string | null;
  toolCount: number;
}
interface ToolsResponse {
  builtin: BotTool[];
  mcpServers: BotMcpServer[];
  mcpToolsByServer: Record<
    string,
    Array<{
      name: string;
      description: string;
      defaultEnabled: boolean;
      effectiveEnabled: boolean;
      override?: ToolOverride;
    }>
  >;
}

const CATEGORY_LABELS: Record<BotTool["category"], string> = {
  builtin: "Built-in actions",
  websearch: "Web search",
  comfyui: "ComfyUI",
  mcp: "MCP",
};

export function ToolsTab({ botId }: { botId: string }) {
  const [data, setData] = useState<ToolsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState<ToolOverrides>({});
  const [mcpServerIds, setMcpServerIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadTools = useCallback(async () => {
    try {
      const r = await botsApi.getTools(botId);
      setData(r);
      // seed local override state from the response (merging all builtin + mcp)
      const merged: ToolOverrides = {};
      for (const t of r.builtin) if (t.override) merged[t.name] = { ...t.override };
      for (const s of r.mcpServers) {
        for (const t of r.mcpToolsByServer[s.id] ?? []) {
          if (t.override) merged[t.name] = { ...t.override };
        }
      }
      setOverrides(merged);
      setMcpServerIds(r.mcpServers.filter((s) => s.enabled).map((s) => s.id));
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    setLoading(true);
    void loadTools();
  }, [botId, loadTools]);

  function setEnabled(name: string, enabled: boolean, defaultEnabled: boolean) {
    setOverrides((o) => {
      const next = { ...o };
      const existing = next[name];
      // if the new value matches the default, drop the override entirely
      if (enabled === defaultEnabled) {
        if (existing) {
          if (existing.description) next[name] = { description: existing.description };
          else delete next[name];
        }
      } else {
        next[name] = { ...existing, enabled };
      }
      return next;
    });
    setDirty(true);
  }

  function setDescription(name: string, description: string) {
    setOverrides((o) => {
      const next = { ...o };
      const trimmed = description.trim();
      if (trimmed === "") {
        if (next[name]?.enabled !== undefined) next[name] = { enabled: next[name]!.enabled };
        else delete next[name];
      } else {
        next[name] = { ...next[name], description: trimmed };
      }
      return next;
    });
    setDirty(true);
  }

  function resetTool(name: string) {
    setOverrides((o) => {
      const next = { ...o };
      delete next[name];
      return next;
    });
    setDirty(true);
  }

  function toggleMcpServer(id: string, on: boolean) {
    setMcpServerIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    const result = await updateBot(botId, { toolOverrides: overrides, mcpServerIds }, { silent: true });
    setSaving(false);
    if (result) {
      setDirty(false);
      toast.show("Tools saved", "success");
      // re-pull so the effective enabled states reflect the new defaults
      await loadTools();
    }
  }

  if (loading) return <LoadingState label="Loading tools..." />;
  if (!data) return <p>Failed to load tools.</p>;

  // group builtins by category, preserving server order for MCP
  const byCategory: Record<string, BotTool[]> = {};
  for (const t of data.builtin) {
    (byCategory[t.category] ??= []).push(t);
  }

  return (
    <div>
      <div class="editor-toolbar">
        <p class="field-hint" style={{ margin: 0 }}>
          <Plug size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />
          Per-tool toggles apply live. Defaults: web search needs a base URL, image gen needs ComfyUI + a workflow.
        </p>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            class="btn btn-ghost btn-sm"
            onClick={() => { setLoading(true); void loadTools(); }}
            title="Reload tools (picks up MCP refetches)"
          >
            <RefreshCw size={14} />
          </button>
          <button class="btn btn-primary btn-sm" onClick={save} disabled={!dirty || saving}>
            <Save size={15} />
            {saving ? "Saving..." : "Save tools"}
          </button>
        </div>
      </div>

      {/* builtin groups */}
      {(["builtin", "websearch", "comfyui"] as const).map((cat) => {
        const tools = byCategory[cat] ?? [];
        if (tools.length === 0) return null;
        return (
          <div class="setting-group" key={cat}>
            <div class="setting-group-title">{CATEGORY_LABELS[cat]}</div>
            {tools.map((t) => (
              <ToolRow
                key={t.name}
                name={t.name}
                description={t.description}
                args={t.args}
                defaultEnabled={t.defaultEnabled}
                override={overrides[t.name]}
                onToggle={(v) => setEnabled(t.name, v, t.defaultEnabled)}
                onDescription={(v) => setDescription(t.name, v)}
                onReset={() => resetTool(t.name)}
              />
            ))}
          </div>
        );
      })}

      {/* MCP section */}
      <div class="setting-group">
        <div class="setting-group-title">
          <Plug2 size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
          MCP servers
        </div>
        <p class="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Enable servers for this bot. Manage servers on the{" "}
          <Link href="/mcp" class="muted-link">
            MCP page
          </Link>
          .
        </p>
        {data.mcpServers.length === 0 ? (
          <p class="field-hint" style={{ fontStyle: "italic" }}>
            No MCP servers registered yet.
          </p>
        ) : (
          data.mcpServers.map((s) => (
            <div key={s.id} class="mcp-server-row">
              <Toggle
                bare
                checked={mcpServerIds.includes(s.id)}
                onChange={(v) => toggleMcpServer(s.id, v)}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>{s.name}</strong>
                  <span class="count-pill">{s.toolCount}</span>
                  {s.lastFetchError && (
                    <span class="badge badge-err" title={s.lastFetchError}>
                      error
                    </span>
                  )}
                </div>
                <div class="bot-card-meta" style={{ fontSize: 11 }}>
                  {s.url}
                  {s.lastFetchedAt && ` - fetched ${timeAgo(s.lastFetchedAt)}`}
                </div>

                {mcpServerIds.includes(s.id) &&
                  (data.mcpToolsByServer[s.id] ?? []).length > 0 && (
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                      {(data.mcpToolsByServer[s.id] ?? []).map((t) => (
                        <ToolRow
                          key={t.name}
                          name={t.name}
                          description={t.description}
                          args={{}}
                          compact
                          defaultEnabled={t.defaultEnabled}
                          override={overrides[t.name]}
                          onToggle={(v) => setEnabled(t.name, v, t.defaultEnabled)}
                          onDescription={(v) => setDescription(t.name, v)}
                          onReset={() => resetTool(t.name)}
                        />
                      ))}
                    </div>
                  )}
                {mcpServerIds.includes(s.id) &&
                  (data.mcpToolsByServer[s.id] ?? []).length === 0 && (
                    <p class="field-hint" style={{ marginTop: 6, fontStyle: "italic" }}>
                      No tools discovered. Refetch on the MCP page.
                    </p>
                  )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface ToolRowProps {
  name: string;
  description: string;
  args?: Record<string, unknown>;
  compact?: boolean;
  defaultEnabled: boolean;
  override?: ToolOverride;
  onToggle: (v: boolean) => void;
  onDescription: (v: string) => void;
  onReset: () => void;
}

function ToolRow(props: ToolRowProps) {
  const { name, description, args, compact, defaultEnabled, override, onToggle, onDescription, onReset } = props;
  const [expanded, setExpanded] = useState(false);

  const enabled = override?.enabled !== undefined ? override.enabled : defaultEnabled;
  const descOverride = override?.description ?? "";
  const hasOverride = override !== undefined;
  const argsPreview = args && Object.keys(args).length > 0 ? `{${Object.keys(args).join(", ")}}` : "";

  return (
    <div class={`tool-row ${compact ? "compact" : ""}`}>
      <div class="tool-row-main">
        <Toggle bare checked={enabled} onChange={onToggle} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <code class="tool-name">{name}</code>
            {argsPreview && <span class="tool-args">{argsPreview}</span>}
            {!enabled && <span class="badge badge-neutral">off</span>}
            {hasOverride && enabled !== defaultEnabled && (
              <span class="badge badge-accent" title="Non-default">
                override
              </span>
            )}
          </div>
          {!compact && (
            <p class="field-hint" style={{ margin: "2px 0 0" }}>
              {descOverride || description}
            </p>
          )}
        </div>
        <button
          class="icon-btn"
          title={expanded ? "Hide override" : "Edit description override"}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 6 }}>
          <TextArea
            label="Description override"
            name={`desc-${name}`}
            value={descOverride}
            placeholder={description}
            onInput={(e) => onDescription((e.target as HTMLTextAreaElement).value)}
            rows={3}
            mono
            hint={hasOverride ? undefined : "Leave blank to use the default description above."}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button class="btn btn-ghost btn-sm" onClick={onReset} disabled={!hasOverride}>
              <RotateCcw size={12} />
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
