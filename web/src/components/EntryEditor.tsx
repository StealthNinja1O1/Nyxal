// entry editor modal. shared by the static lorebook + memory tabs.
// edits a single entry's full field set.

import { useEffect, useMemo, useState } from "preact/hooks";
import { Save } from "lucide-react";
import type { LorebookEntryWire, NewEntry } from "../api/lorebook-types";
import { Modal } from "./Modal";
import { Field } from "./Field";
import { TextArea } from "./TextArea";
import { Toggle } from "./Toggle";
import { Button } from "./Button";

interface Props {
  open: boolean;
  onClose: () => void;
  /** existing entry to edit, or null to create. */
  entry: LorebookEntryWire | null;
  /** used to seed the create form. */
  newDefaults: NewEntry;
  onSave: (value: NewEntry) => Promise<void>;
}

export function EntryEditor({ open, onClose, entry, newDefaults, onSave }: Props) {
  const [draft, setDraft] = useState<NewEntry>(newDefaults);
  const [keysText, setKeysText] = useState("");
  const [secondaryText, setSecondaryText] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (!open) return;
    const src = entry ?? newDefaults;
    setDraft({ ...src });
    setKeysText((src.keys ?? []).join(", "));
    setSecondaryText((src.secondaryKeys ?? []).join(", "));
    setConfirmDiscard(false);
  }, [open, entry]);

  const pristine = entry ?? newDefaults;
  const isDirty = useMemo(() => {
    return (
      draft.name !== pristine.name ||
      draft.priority !== pristine.priority ||
      draft.content !== pristine.content ||
      draft.order !== pristine.order ||
      draft.scanDepth !== pristine.scanDepth ||
      draft.selectiveLogic !== pristine.selectiveLogic ||
      draft.probability !== pristine.probability ||
      draft.useProbability !== pristine.useProbability ||
      draft.enabled !== pristine.enabled ||
      draft.constant !== pristine.constant ||
      draft.caseSensitive !== pristine.caseSensitive ||
      draft.selective !== pristine.selective ||
      parseList(keysText).join("\u0000") !== pristine.keys.join("\u0000") ||
      parseList(secondaryText).join("\u0000") !== pristine.secondaryKeys.join("\u0000")
    );
  }, [draft, keysText, secondaryText, pristine]);

  function requestClose() {
    if (saving) return;
    if (isDirty) setConfirmDiscard(true);
    else onClose();
  }

  if (!open) return null;

  function set<K extends keyof NewEntry>(key: K, value: NewEntry[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function submit(e: Event) {
    e.preventDefault();
    setSaving(true);
    const finalDraft: NewEntry = {
      ...draft,
      keys: parseList(keysText),
      secondaryKeys: parseList(secondaryText),
    };
    await onSave(finalDraft);
    setSaving(false);
  }

  return (
    <Modal
      open
      size="lg"
      title={entry ? `Edit "${entry.name}"` : "New entry"}
      onClose={requestClose}
      footer={
        <>
          <Button variant="ghost" onClick={requestClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="entry-form" loading={saving} disabled={saving}>
            <Save size={15} />
            {entry ? "Save entry" : "Create entry"}
          </Button>
        </>
      }
    >
      <form id="entry-form" onSubmit={submit}>
        {confirmDiscard && (
          <div class="callout callout-warn" style={{ marginBottom: 12 }}>
            <p style={{ margin: 0, marginBottom: 10 }}>You have unsaved changes. Discard them and close?</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
              <Button size="sm" variant="danger" onClick={() => { setConfirmDiscard(false); onClose(); }}>
                Discard
              </Button>
            </div>
          </div>
        )}
        <div class="setting-row-grid">
          <Field
            label="Name"
            name="name"
            value={draft.name}
            onInput={(e) => set("name", (e.target as HTMLInputElement).value)}
            placeholder="SteakedGamer"
          />
          <Field
            label="Priority"
            name="priority"
            type="number"
            value={String(draft.priority)}
            onInput={(e) => set("priority", Number((e.target as HTMLInputElement).value) || 0)}
            hint="Higher = wins when multiple match."
          />
        </div>

        <Field
          label="Keys (comma separated)"
          name="keys"
          value={keysText}
          onInput={(e) => setKeysText((e.target as HTMLInputElement).value)}
          hint="Substring match in chat history that activates this entry."
        />

        <TextArea
          label="Content"
          name="content"
          value={draft.content}
          onInput={(e) => set("content", (e.target as HTMLTextAreaElement).value)}
          rows={6}
          hint="What gets injected into the prompt when this entry activates."
        />

        <details class="entry-advanced">
          <summary>Advanced (order, secondary keys, probability, scan depth)</summary>

          <div class="setting-row-grid">
            <Field
              label="Order"
              name="order"
              type="number"
              value={String(draft.order)}
              onInput={(e) => set("order", Number((e.target as HTMLInputElement).value) || 0)}
              hint="Sort position when multiple activate. Lower first."
            />
            <Field
              label="Scan depth"
              name="scanDepth"
              type="number"
              value={draft.scanDepth === null ? "" : String(draft.scanDepth)}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                set("scanDepth", v === "" ? null : Number(v));
              }}
              hint="Messages from the end to scan. Blank = book default (12)."
            />
          </div>

          <Field
            label="Secondary keys (comma separated)"
            name="secondaryKeys"
            value={secondaryText}
            onInput={(e) => setSecondaryText((e.target as HTMLInputElement).value)}
            hint="Additional keys combined with the main keys via the logic below."
          />

          <div class="setting-row-grid">
            <div class="field">
              <label class="field-label" for="selectiveLogic">Secondary key logic</label>
              <select
                id="selectiveLogic"
                class="field-input"
                value={String(draft.selectiveLogic)}
                onChange={(e) => set("selectiveLogic", Number((e.target as HTMLSelectElement).value))}
              >
                <option value="0">AND ANY (at least one must match)</option>
                <option value="1">NOT ALL (not all match)</option>
                <option value="2">NOT ANY (none match)</option>
                <option value="3">AND ALL (all must match)</option>
              </select>
            </div>
            <div class="setting-row-grid">
              <Field
                label="Probability %"
                name="probability"
                type="number"
                min="0"
                max="100"
                value={String(draft.probability)}
                onInput={(e) => set("probability", Number((e.target as HTMLInputElement).value) || 0)}
              />
            </div>
          </div>
          <Toggle
            label="Use probability"
            hint="Roll the probability above each activation. Off = always activate."
            checked={draft.useProbability}
            onChange={(v) => set("useProbability", v)}
          />
        </details>

        <div class="setting-group" style={{ marginTop: 12 }}>
          <div class="setting-group-title">Activation</div>
          <Toggle
            label="Enabled"
            checked={draft.enabled}
            onChange={(v) => set("enabled", v)}
          />
          <Toggle
            label="Constant (always inject)"
            hint="Skip key matching entirely - always include this entry."
            checked={draft.constant}
            onChange={(v) => set("constant", v)}
          />
          <Toggle
            label="Case sensitive matching"
            checked={draft.caseSensitive}
            onChange={(v) => set("caseSensitive", v)}
          />
          <Toggle
            label="Selective"
            hint="Requires secondary keys to also match (uses the logic above)."
            checked={draft.selective}
            onChange={(v) => set("selective", v)}
          />
        </div>
      </form>
    </Modal>
  );
}

function parseList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}
