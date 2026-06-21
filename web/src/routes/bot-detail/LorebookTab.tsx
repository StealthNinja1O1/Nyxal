// shared lorebook/memory tab. lists entries, supports create/edit/delete +
// import (merge or replace). the only difference between "static" and "memory"
// is the book param + a help-string; everything else is identical.

import { useEffect, useMemo, useState } from "preact/hooks";
import { Plus, Pencil, Trash2, BookOpen, Brain, ArrowDownUp } from "lucide-react";
import { lorebookApi } from "../../api/lorebook";
import type { LorebookEntryWire, NewEntry, Book } from "../../api/lorebook-types";
import { newEntryDefaults } from "../../api/lorebook-types";
import { EntryEditor } from "../../components/EntryEditor";
import { ImportDropdown } from "../../components/ImportButton";
import { Button } from "../../components/Button";
import { Badge } from "../../components/Badge";
import { Toggle } from "../../components/Toggle";
import { LoadingState, EmptyState } from "../../components/State";
import { Modal } from "../../components/Modal";
import { toast } from "../../state/toast";
import { parseChatMemoryJson, parseCharacterBook } from "../../lib/importers";

type SortMode = "order" | "name" | "updated-new" | "updated-old" | "priority";
const SORT_LABELS: Record<SortMode, string> = {
  order: "Insertion order",
  name: "Name (A-Z)",
  "updated-new": "Updated (newest)",
  "updated-old": "Updated (oldest)",
  priority: "Priority",
};

interface Props {
  botId: string;
  book: Book;
}

export function LorebookTab({ botId, book }: Props) {
  const [entries, setEntries] = useState<LorebookEntryWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("order");
  const [editing, setEditing] = useState<{ open: boolean; entry: LorebookEntryWire | null }>({
    open: false,
    entry: null,
  });
  const [confirmDel, setConfirmDel] = useState<LorebookEntryWire | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const sortedEntries = useMemo(() => {
    const arr = [...entries];
    switch (sortMode) {
      case "name":
        return arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      case "updated-new":
        return arr.sort((a, b) => b.updatedAt - a.updatedAt);
      case "updated-old":
        return arr.sort((a, b) => a.updatedAt - b.updatedAt);
      case "priority":
        return arr.sort((a, b) => b.priority - a.priority);
      case "order":
      default:
        // stable - preserve server order
        return arr;
    }
  }, [entries, sortMode]);

  async function toggleEnabled(entry: LorebookEntryWire, next: boolean) {
    // optimistic update
    setEntries((es) => es.map((e) => (e.id === entry.id ? { ...e, enabled: next } : e)));
    setTogglingId(entry.id);
    try {
      await lorebookApi.update(botId, book, entry.id, { enabled: next });
      toast.show(`Entry "${entry.name}" ${next ? "enabled" : "disabled"}`, "success");
    } catch (err) {
      // roll back on failure
      setEntries((es) => es.map((e) => (e.id === entry.id ? { ...e, enabled: entry.enabled } : e)));
      toast.show(`Toggle failed: ${msg(err)}`, "error");
    } finally {
      setTogglingId(null);
    }
  }

  useEffect(() => {
    void reload();
  }, [botId, book]);

  async function reload() {
    setLoading(true);
    try {
      setEntries(await lorebookApi.list(botId, book));
    } catch (err) {
      toast.show(`Failed to load ${book} entries: ${msg(err)}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function saveEntry(draft: NewEntry) {
    try {
      if (editing.entry) {
        const updated = await lorebookApi.update(botId, book, editing.entry.id, draft);
        setEntries((es) => es.map((e) => (e.id === updated.id ? updated : e)));
        toast.show(`Entry "${updated.name}" updated`, "success");
      } else {
        const created = await lorebookApi.create(botId, book, draft);
        setEntries((es) => [...es, created]);
        toast.show(`Entry "${created.name}" created`, "success");
      }
      setEditing({ open: false, entry: null });
    } catch (err) {
      toast.show(`Save failed: ${msg(err)}`, "error");
    }
  }

  async function deleteEntry(entry: LorebookEntryWire) {
    try {
      await lorebookApi.remove(botId, book, entry.id);
      setEntries((es) => es.filter((e) => e.id !== entry.id));
      toast.show(`Entry "${entry.name}" deleted`, "success");
      setConfirmDel(null);
    } catch (err) {
      toast.show(`Delete failed: ${msg(err)}`, "error");
    }
  }

  async function doImport(mode: "merge" | "replace", text: string, filename: string) {
    try {
      // accept either a chatMemory.json shape or a character card book
      let parsed: NewEntry[];
      try {
        parsed = parseChatMemoryJson(text);
        if (parsed.length === 0) throw new Error("no entries");
      } catch {
        const book2 = parseCharacterBook(text);
        if (!book2 || book2.length === 0) throw new Error("File has no entries. Expected chatMemory.json or a character card with a character_book.");
        parsed = book2;
      }
      const result = await lorebookApi.import(botId, book, parsed, mode);
      toast.show(`Imported ${result.imported} entries from ${filename} (${mode})`, "success");
      await reload();
    } catch (err) {
      toast.show(`Import failed: ${msg(err)}`, "error");
    }
  }

  const isMemory = book === "memory";
  const icon = isMemory ? <Brain size={32} /> : <BookOpen size={32} />;
  const subtitle = isMemory
    ? "Dynamic entries the bot writes itself via editOrAddToLorebook. Import your chatMemory.json here."
    : "Read-only-to-the-bot lore entries (from character.json's character_book). The bot can read these but not modify them.";

  return (
    <div>
      <div class="editor-toolbar">
        <div>
          <Button size="sm" onClick={() => setEditing({ open: true, entry: null })}>
            <Plus size={15} />
            New entry
          </Button>
        </div>
        <div class="sort-select-wrap">
          <ArrowDownUp size={14} />
          <select
            class="field-input sort-select"
            value={sortMode}
            onChange={(e) => setSortMode((e.target as HTMLSelectElement).value as SortMode)}
            aria-label="Sort entries"
          >
            {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {SORT_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
        <ImportDropdown label="Import" onImport={doImport} />
      </div>

      {loading ? (
        <LoadingState label={`Loading ${book} entries...`} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={icon}
          title={`No ${book} entries yet`}
          subtitle={subtitle}
          action={
            <Button size="sm" onClick={() => setEditing({ open: true, entry: null })}>
              <Plus size={15} />
              Add an entry
            </Button>
          }
        />
      ) : (
        <div class="list-card">
          <div class="list-header">
            <h2>
              {isMemory ? "Memory book" : "Static lorebook"}{" "}
              <span class="count-pill">{entries.length}</span>
            </h2>
          </div>
          {sortedEntries.map((entry) => (
            <div class="list-row-wrap" key={entry.id}>
              <div class="list-row">
                <div class="list-row-main">
                  <div class="list-row-title-line">
                    <Toggle
                      bare
                      checked={entry.enabled}
                      disabled={togglingId === entry.id}
                      onChange={(v) => void toggleEnabled(entry, v)}
                      aria-label={`Toggle ${entry.name}`}
                    />
                    <span class="list-row-title">{entry.name || "(unnamed)"}</span>
                    {entry.constant && <Badge tone="accent">constant</Badge>}
                    {entry.selective && <Badge tone="info">selective</Badge>}
                    {entry.useProbability && <Badge tone="neutral">{entry.probability}%</Badge>}
                  </div>
                  <div class="list-row-sub">
                    keys: {entry.keys.join(", ") || "(none)"}
                  </div>
                  <div class="entry-preview">{entry.content.slice(0, 160)}{entry.content.length > 160 ? "..." : ""}</div>
                </div>
                <div class="list-row-actions">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ open: true, entry })} aria-label="Edit">
                    <Pencil size={14} />
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setConfirmDel(entry)} aria-label="Delete">
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <EntryEditor
        open={editing.open}
        entry={editing.entry}
        newDefaults={newEntryDefaults()}
        onClose={() => setEditing({ open: false, entry: null })}
        onSave={saveEntry}
      />

      {confirmDel && (
        <Modal
          open
          title={`Delete "${confirmDel.name || "(unnamed)"}"?`}
          onClose={() => setConfirmDel(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => void deleteEntry(confirmDel)}>
                <Trash2 size={15} />
                Delete
              </Button>
            </>
          }
        >
          <p>This removes the entry from the {book} book. Cannot be undone.</p>
        </Modal>
      )}
    </div>
  );
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
