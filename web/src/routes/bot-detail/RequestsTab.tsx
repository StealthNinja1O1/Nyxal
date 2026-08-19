// LLM request viewer. Shows the last 25 request bodies submitted to the
// provider (chat turns, recursive follow-ups and summary calls, each tagged).
// The system prompt renders as a collapsible block; assistant messages are
// unwrapped from their {"reply", "commands"} JSON so they read like chat,
// with a raw toggle for debugging.

import { useEffect, useState } from "preact/hooks";
import { RotateCw, Send, ChevronDown, ChevronRight, Code2, MessageSquare } from "lucide-react";
import { requestsApi } from "../../api/requests";
import type { CapturedLlmMessage, CapturedMessagePart, LlmRequestCapture } from "@shared/types";
import { Button } from "../../components/Button";
import { Badge } from "../../components/Badge";
import { Toggle } from "../../components/Toggle";
import { LoadingState, EmptyState } from "../../components/State";
import { toast } from "../../state/toast";

interface Props {
  botId: string;
}

const SOURCE_TONES: Record<string, "accent" | "info" | "neutral"> = {
  chat: "accent",
  followup: "info",
  summary: "neutral",
};

function parseAssistant(content: string): { reply: string; commands: unknown[] } | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && typeof parsed.reply === "string") {
      return { reply: parsed.reply, commands: Array.isArray(parsed.commands) ? parsed.commands : [] };
    }
  } catch {
    // not json, render raw
  }
  return null;
}

function partsToText(content: string | CapturedMessagePart[]): string {
  if (typeof content === "string") return content;
  return content
    .map((p) => (p.type === "text" ? p.text ?? "" : p.note ?? "[image]"))
    .join("\n");
}

export function RequestsTab({ botId }: Props) {
  const [captures, setCaptures] = useState<LlmRequestCapture[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rawMode, setRawMode] = useState(false);
  const [openSystem, setOpenSystem] = useState(false);

  useEffect(() => {
    void reload();
  }, [botId]);

  async function reload() {
    setLoading(true);
    try {
      const res = await requestsApi.list(botId);
      setCaptures(res.captures);
      // keep selection stable if the row still exists, else pick the newest
      setSelectedId((prev) => (res.captures.some((c) => c.id === prev) ? prev : (res.captures[0]?.id ?? null)));
    } catch (err) {
      toast.show(`Failed to load requests: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setLoading(false);
    }
  }

  const selected = captures.find((c) => c.id === selectedId) ?? null;

  return (
    <div>
      <div class="editor-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Last submitted LLM requests</span>
          <span class="count-pill">{captures.length}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Toggle label="Raw view" checked={rawMode} onChange={setRawMode} />
          <Button variant="ghost" size="sm" loading={loading} onClick={() => void reload()} aria-label="Refresh requests">
            <RotateCw size={15} />
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading requests..." />
      ) : captures.length === 0 ? (
        <EmptyState
          icon={<Send size={32} />}
          title="No captured requests yet"
          subtitle="Every LLM call this bot makes (chat replies, follow-ups, summaries) is captured here, newest first. Send a message and refresh."
        />
      ) : (
        <div class="req-layout">
          <div class="req-list">
            {captures.map((c) => (
              <button
                key={c.id}
                type="button"
                class={`req-item ${c.id === selectedId ? "active" : ""}`}
                onClick={() => {
                  setSelectedId(c.id);
                  setOpenSystem(false);
                }}
              >
                <div class="req-item-top">
                  <Badge tone={SOURCE_TONES[c.source] ?? "neutral"}>{c.source}</Badge>
                  <span class="req-item-time">{new Date(c.createdAt).toLocaleTimeString()}</span>
                </div>
                <div class="req-item-model">{c.model || "unknown model"}</div>
                <div class="req-item-meta">
                  {c.messages.length} msgs
                  {c.promptTokens > 0 ? ` - ${c.promptTokens} tok` : ""}
                  {!c.success ? " - FAILED" : ""}
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <div class="req-detail">
              <div class="req-detail-header">
                <div>
                  <strong>{selected.model}</strong>
                  <span class="field-hint" style={{ marginLeft: 8 }}>
                    {new Date(selected.createdAt).toLocaleString()} - temp {selected.temperature}
                    {selected.promptTokens > 0 ? ` - ${selected.promptTokens} prompt tokens` : ""}
                  </span>
                </div>
                <Badge tone={SOURCE_TONES[selected.source] ?? "neutral"}>{selected.source}</Badge>
              </div>
              {selected.messages.map((m, i) => (
                <RequestMessage key={i} msg={m} rawMode={rawMode} systemOpen={openSystem} onToggleSystem={() => setOpenSystem((v) => !v)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RequestMessage({
  msg,
  rawMode,
  systemOpen,
  onToggleSystem,
}: {
  msg: CapturedLlmMessage;
  rawMode: boolean;
  systemOpen: boolean;
  onToggleSystem: () => void;
}) {
  const isSystem = msg.role === "system";
  const isTool = msg.role === "tool";
  const text = partsToText(msg.content ?? "");

  if (isSystem) {
    return (
      <div class="req-msg req-msg-system">
        <button type="button" class="req-msg-head" onClick={onToggleSystem}>
          {systemOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span class="req-role req-role-system">system</span>
          <span class="field-hint">{systemOpen ? "click to collapse" : `${text.length} chars, click to expand`}</span>
        </button>
        {systemOpen && <div class="req-content mono">{text}</div>}
      </div>
    );
  }

  const parsed = !rawMode && msg.role === "assistant" && !msg.tool_calls ? parseAssistant(text) : null;

  return (
    <div class={`req-msg ${msg.role === "assistant" ? "req-msg-assistant" : "req-msg-user"}`}>
      <div class="req-msg-head">
        <span class={`req-role ${msg.role === "assistant" ? "req-role-assistant" : "req-role-user"}`}>
          {isTool ? `tool ${msg.tool_call_id ? `\u2192 ${msg.tool_call_id.slice(-10)}` : ""}` : msg.role}
        </span>
      </div>
      {parsed ? (
        <div class="req-content">
          <div style={{ whiteSpace: "pre-wrap" }}>{parsed.reply}</div>
          {parsed.commands.length > 0 && (
            <div class="req-cmds">
              {parsed.commands.map((c, i) => (
                <span key={i} class="req-cmd">
                  <Code2 size={12} style={{ verticalAlign: "-2px" }} />{" "}
                  {typeof c === "object" && c !== null && "name" in c
                    ? `${(c as { name: string }).name}(${JSON.stringify((c as { args?: unknown }).args ?? {})})`
                    : JSON.stringify(c)}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div class={`req-content ${rawMode ? "mono" : ""}`}>{text}</div>
      )}
      {msg.tool_calls && msg.tool_calls.length > 0 && (
        <div class="req-cmds">
          {msg.tool_calls.map((tc, i) => (
            <span key={i} class="req-cmd">
              <Code2 size={12} style={{ verticalAlign: "-2px" }} />{" "}
              {tc.function.name}({tc.function.arguments})
            </span>
          ))}
        </div>
      )}
      {typeof msg.content !== "string" && !rawMode && (
        <div class="field-hint" style={{ marginTop: 4 }}>
          <MessageSquare size={12} style={{ verticalAlign: "-2px" }} /> message contained image parts, see raw view
        </div>
      )}
    </div>
  );
}
