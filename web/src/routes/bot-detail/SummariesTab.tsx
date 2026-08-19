// Summaries viewer/editor. Lists every conversation summary the bot has
// written, grouped by channel. Supports inline text editing, single delete
// (watermark is recomputed server-side) and per-channel clear.

import { useEffect, useRef, useState } from "preact/hooks";
import { RotateCw, Pencil, Trash2, Brain, ChevronDown, ChevronRight, Check, X } from "lucide-react";
import { summariesApi, type SummaryChannelGroup, type SummaryWire } from "../../api/summaries";
import { Button } from "../../components/Button";
import { Badge } from "../../components/Badge";
import { Modal } from "../../components/Modal";
import { LoadingState, EmptyState } from "../../components/State";
import { toast } from "../../state/toast";

interface Props {
  botId: string;
}

export function SummariesTab({ botId }: Props) {
  const [groups, setGroups] = useState<SummaryChannelGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDel, setConfirmDel] = useState<SummaryWire | null>(null);
  const [confirmClear, setConfirmClear] = useState<SummaryChannelGroup | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void reload();
  }, [botId]);

  // auto-scale the editor textarea to its content (full height, no inner
  // scrollbar while editing)
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editingId]);

  async function reload() {
    setLoading(true);
    try {
      const res = await summariesApi.list(botId);
      setGroups(res.channels);
    } catch (err) {
      toast.show(`Failed to load summaries: ${msg(err)}`, "error");
    } finally {
      setLoading(false);
    }
  }

  function toggleChannel(channelId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  }

  function startEdit(s: SummaryWire) {
    setEditingId(s.id);
    setDraft(s.content);
  }

  async function saveEdit() {
    if (!editingId) return;
    const content = draft.trim();
    if (!content) {
      toast.show("Summary text cannot be empty", "error");
      return;
    }
    setSavingEdit(true);
    try {
      await summariesApi.update(botId, editingId, content);
      setGroups((gs) =>
        gs.map((g) => ({
          ...g,
          summaries: g.summaries.map((s) => (s.id === editingId ? { ...s, content } : s)),
        })),
      );
      setEditingId(null);
      toast.show("Summary updated", "success");
    } catch (err) {
      toast.show(`Save failed: ${msg(err)}`, "error");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteSummary(s: SummaryWire) {
    try {
      await summariesApi.remove(botId, s.id);
      setGroups((gs) =>
        gs
          .map((g) => ({ ...g, summaries: g.summaries.filter((x) => x.id !== s.id) }))
          .filter((g) => g.summaries.length > 0),
      );
      setConfirmDel(null);
      toast.show(`Recap #${s.seq + 1} deleted`, "success");
    } catch (err) {
      toast.show(`Delete failed: ${msg(err)}`, "error");
    }
  }

  async function clearChannel(g: SummaryChannelGroup) {
    try {
      await summariesApi.clearChannel(botId, g.channelId);
      setGroups((gs) => gs.filter((x) => x.channelId !== g.channelId));
      setConfirmClear(null);
      toast.show(`Cleared all summaries for channel ${g.channelId}`, "success");
    } catch (err) {
      toast.show(`Clear failed: ${msg(err)}`, "error");
    }
  }

  const totalSummaries = groups.reduce((n, g) => n + g.summaries.length, 0);

  return (
    <div>
      <div class="editor-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Conversation summaries</span>
          <span class="count-pill">{totalSummaries}</span>
        </div>
        <Button variant="ghost" size="sm" loading={loading} onClick={() => void reload()} aria-label="Refresh summaries">
          <RotateCw size={15} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <LoadingState label="Loading summaries..." />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Brain size={32} />}
          title="No summaries yet"
          subtitle="Summaries appear here once a conversation crosses the token threshold (or the message-count fallback) configured on the Extensions tab."
        />
      ) : (
        groups.map((g) => {
          const isCollapsed = collapsed.has(g.channelId);
          return (
            <div class="list-card" key={g.channelId} style={{ marginBottom: 14 }}>
              <div class="list-header">
                <h2 style={{ cursor: "pointer" }} onClick={() => toggleChannel(g.channelId)}>
                  {isCollapsed ? <ChevronRight size={16} style={{ verticalAlign: "-2px" }} /> : <ChevronDown size={16} style={{ verticalAlign: "-2px" }} />}{" "}
                  Channel {g.channelId} <span class="count-pill">{g.summaries.length}</span>
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setConfirmClear(g)}>
                  <Trash2 size={14} />
                  Clear channel
                </Button>
              </div>
              {!isCollapsed &&
                g.summaries.map((s) => (
                  <div class="list-row-wrap" key={s.id}>
                    <div class="list-row">
                      <div class="list-row-main">
                        <div class="list-row-title-line">
                          <span class="list-row-title">Recap #{s.seq + 1}</span>
                          <Badge tone="neutral">{s.tokenEstimate} tok</Badge>
                          <span class="field-hint">{new Date(s.createdAt).toLocaleString()}</span>
                        </div>
                        {editingId === s.id ? (
                          <div style={{ marginTop: 8, width: "100%" }}>
                            <textarea
                              ref={editorRef}
                              class="field-input field-textarea"
                              style={{ width: "100%", boxSizing: "border-box", minHeight: 120 }}
                              rows={8}
                              value={draft}
                              onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                            />
                            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                              <Button size="sm" loading={savingEdit} onClick={() => void saveEdit()}>
                                <Check size={14} />
                                Save
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                                <X size={14} />
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div
                            class="entry-preview"
                            style={{ whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto", cursor: "pointer" }}
                            onClick={() => startEdit(s)}
                            title="Click to edit"
                          >
                            {s.content}
                          </div>
                        )}
                      </div>
                      <div class="list-row-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => (editingId === s.id ? setEditingId(null) : startEdit(s))}
                          aria-label="Edit summary"
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => setConfirmDel(s)} aria-label="Delete summary">
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          );
        })
      )}

      {confirmDel && (
        <Modal
          open
          title={`Delete recap #${confirmDel.seq + 1}?`}
          onClose={() => setConfirmDel(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDel(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void deleteSummary(confirmDel)}>
                <Trash2 size={15} />
                Delete
              </Button>
            </>
          }
        >
          <p>
            The summary text is removed and the channel watermark is recomputed. If the messages it covered are still
            within the recent-message fetch window they return verbatim; otherwise that content is gone for good.
          </p>
        </Modal>
      )}

      {confirmClear && (
        <Modal
          open
          title={`Clear all ${confirmClear.summaries.length} summaries for this channel?`}
          onClose={() => setConfirmClear(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmClear(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void clearChannel(confirmClear)}>
                <Trash2 size={15} />
                Clear channel
              </Button>
            </>
          }
        >
          <p>
            Deletes every summary and resets the watermark for channel {confirmClear.channelId}. The bot starts
            summarizing from scratch on the next conversation activity.
          </p>
        </Modal>
      )}
    </div>
  );
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
