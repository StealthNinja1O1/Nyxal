// MCP servers management page. CRUD + refetch (live listTools call) +
// per-server tool list drawer. bot-level enable/disable happens on the
// per-bot Tools tab.

import { useEffect, useState } from "preact/hooks";
import { Plug, Plus, Pencil, Trash2, RefreshCw, Zap, ChevronDown, ChevronRight, Wrench } from "lucide-react";
import {
  mcpServers,
  mcpLoading,
  loadMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  refetchMcpServer,
  testMcpServer,
} from "../state/mcp";
import { mcpApi } from "../api/mcp";
import type { McpServer, McpTool } from "@shared/types";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { Badge } from "../components/Badge";
import { LoadingState, EmptyState } from "../components/State";

type EditorMode = { kind: "create" } | { kind: "edit"; server: McpServer } | null;

export function McpRoute() {
  const [editor, setEditor] = useState<EditorMode>(null);

  useEffect(() => {
    void loadMcpServers();
  }, []);

  return (
    <section>
      <div class="list-card">
        <div class="list-header">
          <h2>
            MCP servers <span class="count-pill">{mcpServers.value.length}</span>
          </h2>
          <Button size="sm" onClick={() => setEditor({ kind: "create" })}>
            <Plus size={16} />
            New server
          </Button>
        </div>

        <p class="field-hint" style={{ marginTop: 0, marginBottom: 16 }}>
          HTTP-only MCP servers. Add one, hit Refetch to discover its tools, then enable it per-bot on the bot's Tools tab.
        </p>

        {mcpLoading.value ? (
          <LoadingState label="Loading MCP servers..." />
        ) : mcpServers.value.length === 0 ? (
          <EmptyState
            icon={<Plug size={32} />}
            title="No MCP servers yet"
            subtitle="Connect any HTTP MCP server. Tools are discovered once, cached, and toggled per-bot."
            action={
              <Button onClick={() => setEditor({ kind: "create" })}>
                <Plus size={16} />
                Add your first server
              </Button>
            }
          />
        ) : (
          <div>
            {mcpServers.value.map((s) => (
              <McpServerRow key={s.id} server={s} onEdit={() => setEditor({ kind: "edit", server: s })} />
            ))}
          </div>
        )}
      </div>

      <McpEditor
        mode={editor}
        onClose={() => setEditor(null)}
        onCreate={async (input) => {
          const c = await createMcpServer(input);
          if (c) setEditor(null);
        }}
        onUpdate={async (id, patch) => {
          const ok = await updateMcpServer(id, patch);
          if (ok) setEditor(null);
        }}
      />
    </section>
  );
}

function McpServerRow({ server, onEdit }: { server: McpServer; onEdit: () => void }) {
  const [busy, setBusy] = useState<"" | "refetch" | "test" | "delete">("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);

  async function onRefetch() {
    setBusy("refetch");
    await refetchMcpServer(server.id);
    setBusy("");
  }
  async function onTest() {
    setBusy("test");
    await testMcpServer(server.id);
    setBusy("");
  }
  async function onDelete() {
    setBusy("delete");
    const ok = await deleteMcpServer(server.id);
    if (!ok) setBusy("");
  }

  async function toggleTools() {
    if (toolsOpen) {
      setToolsOpen(false);
      return;
    }
    setToolsOpen(true);
    if (tools !== null) return;
    try {
      setTools(await mcpApi.listTools(server.id));
      setToolsError(null);
    } catch (err) {
      setToolsError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div class="list-row-wrap">
      <div class="list-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong>{server.name}</strong>
            <Badge>{server.toolCount ?? 0} tools</Badge>
            {server.lastFetchError ? (
              <span class="badge badge-err" title={server.lastFetchError}>
                last refetch failed
              </span>
            ) : server.lastFetchedAt ? (
              <span class="bot-card-meta">fetched {timeAgo(server.lastFetchedAt)}</span>
            ) : (
              <span class="bot-card-meta">never fetched</span>
            )}
          </div>
          <div class="bot-card-meta" style={{ marginTop: 2 }}>
            {server.url}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="subtle" size="sm" onClick={toggleTools}>
            {toolsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Tools
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={onRefetch}
            loading={busy === "refetch"}
            disabled={!!busy}
            title="Reconnect and re-discover tools"
          >
            <RefreshCw size={14} />
            Refetch
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onTest}
            loading={busy === "test"}
            disabled={!!busy}
            title="Ping the server without writing anything"
          >
            <Zap size={14} />
            Test
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} disabled={!!busy} title="Edit name / URL / headers">
            <Pencil size={14} />
          </Button>
          {confirmDel ? (
            <>
              <Button variant="danger" size="sm" onClick={onDelete} loading={busy === "delete"} disabled={!!busy}>
                Confirm
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDel(false)} disabled={!!busy}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDel(true)}
              disabled={!!busy}
              title="Delete this server (also removes it from all bots)"
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      </div>

      {toolsOpen && (
        <div class="list-row-tools">
          {toolsError ? (
            <p class="field-error">Failed to load tools: {toolsError}</p>
          ) : tools === null ? (
            <p class="field-hint">Loading...</p>
          ) : tools.length === 0 ? (
            <p class="field-hint">
              No tools cached. Hit <strong>Refetch</strong> to discover them.
            </p>
          ) : (
            <table class="data-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.name}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <code>{t.name}</code>
                    </td>
                    <td>
                      <div>{t.description || <span class="muted">(no description)</span>}</div>
                      {t.inputSchema && (
                        <details>
                          <summary class="field-hint" style={{ cursor: "pointer" }}>
                            <Wrench size={11} style={{ verticalAlign: "middle", marginRight: 4 }} />
                            input schema
                          </summary>
                          <pre class="mono" style={{ fontSize: 11, marginTop: 4 }}>
                            {JSON.stringify(t.inputSchema, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

interface EditorProps {
  mode: EditorMode;
  onClose: () => void;
  onCreate: (input: { name: string; url: string; headers?: Record<string, string> }) => Promise<void>;
  onUpdate: (id: string, patch: { name?: string; url?: string; headers?: Record<string, string> }) => Promise<void>;
}

function McpEditor({ mode, onClose, onCreate, onUpdate }: EditorProps) {
  const editing = mode?.kind === "edit" ? mode.server : null;
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // reseed fields when the modal opens for create vs edit
  useEffect(() => {
    if (!mode) return;
    setName(editing?.name ?? "");
    setUrl(editing?.url ?? "");
    setHeadersText(editing ? formatHeaders(editing.headers) : "");
    setError(null);
  }, [mode, editing]);

  if (!mode) return null;

  function parseHeaders(): Record<string, string> | string {
    const text = headersText.trim();
    if (!text) return {};
    // try JSON first
    try {
      const j = JSON.parse(text);
      if (j && typeof j === "object" && !Array.isArray(j)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(j)) out[k] = String(v);
        return out;
      }
      return "Headers JSON must be an object of string -> string.";
    } catch {
      // fall through to key:value lines
    }
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(":");
      if (idx === -1) return `Bad header line (no colon): "${trimmed}"`;
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      if (!k) return `Bad header line (empty key): "${trimmed}"`;
      out[k] = v;
    }
    return out;
  }

  async function save() {
    setError(null);
    if (!mode) return;
    const isCreate = mode.kind === "create";
    if (!name.trim()) return setError("Name is required.");
    if (!url.trim()) return setError("URL is required.");
    try {
      new URL(url.trim());
    } catch {
      return setError("URL is not valid.");
    }
    const headers = parseHeaders();
    if (typeof headers === "string") return setError(headers);

    setSaving(true);
    try {
      if (isCreate) {
        await onCreate({ name: name.trim(), url: url.trim(), headers });
      } else {
        await onUpdate(mode.server.id, { name: name.trim(), url: url.trim(), headers });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={editing ? `Edit ${editing.name}` : "Add MCP server"}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={saving}>
            {editing ? "Save" : "Add server"}
          </Button>
        </>
      }
    >
      {error && <p class="field-error">{error}</p>}
      <Field
        label="Name"
        name="mcpName"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        hint="Used in tool names: mcp__<name>__<tool>."
      />
      <Field
        label="URL"
        name="mcpUrl"
        value={url}
        onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
        placeholder="http://my-mcp:8080/mcp"
        hint="HTTP transport endpoint. Must be reachable from the Nyxal container."
      />
      <div class="field">
        <label class="field-label" for="mcpHeaders">
          Headers (optional)
        </label>
        <textarea
          id="mcpHeaders"
          class="field-input field-textarea mono"
          rows={4}
          value={headersText}
          onInput={(e) => setHeadersText((e.target as HTMLTextAreaElement).value)}
          placeholder={`Authorization: Bearer ...`}
        />
        <p class="field-hint">
          One <code>Key: value</code> per line, or a JSON object. Useful for auth tokens.
        </p>
      </div>
    </Modal>
  );
}

function formatHeaders(headers: Record<string, string>): string {
  const entries = Object.entries(headers ?? {});
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}: ${v}`).join("\n");
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
