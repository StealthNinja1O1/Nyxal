import { useEffect, useState } from "preact/hooks";
import { Save, FileText, RotateCcw, Download } from "lucide-react";
import { botsApi } from "../../api/bots";
import type { Character } from "../../api/bots-types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { TextArea } from "../../components/TextArea";
import { LoadingState } from "../../components/State";
import { ImportButton } from "../../components/ImportButton";
import { toast } from "../../state/toast";
import { parseCharacterCard, tryParseJson } from "../../lib/importers";

export function CharacterTab({ botId }: { botId: string }) {
  const [char, setChar] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // local editable copies
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mesExample, setMesExample] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [depthPromptText, setDepthPromptText] = useState("");
  const [depthPromptDepth, setDepthPromptDepth] = useState(2);

  useEffect(() => {
    void (async () => {
      try {
        const c = await botsApi.getCharacter(botId);
        setChar(c);
        setName(c.name);
        setDescription(c.description);
        setMesExample(c.mesExample);
        setSystemPrompt(c.systemPrompt ?? "");
        setDepthPromptText(c.depthPrompt?.prompt ?? "");
        setDepthPromptDepth(c.depthPrompt?.depth ?? 2);
      } finally {
        setLoading(false);
      }
    })();
  }, [botId]);

  async function save() {
    setSaving(true);
    try {
      const depthPrompt =
        depthPromptText.trim().length > 0
          ? { depth: depthPromptDepth, prompt: depthPromptText.trim(), role: "user" as const }
          : null;
      const updated = await botsApi.updateCharacter(botId, {
        name,
        description,
        mesExample,
        systemPrompt,
        depthPrompt,
      });
      setChar(updated);
      setSystemPrompt(updated.systemPrompt ?? "");
      toast.show("Character saved", "success");
    } finally {
      setSaving(false);
    }
  }

  async function resetSystemPrompt() {
    setSaving(true);
    try {
      const updated = await botsApi.updateCharacter(botId, { systemPrompt: "" });
      setChar(updated);
      setSystemPrompt("");
      toast.show("System prompt reset to default", "info");
    } finally {
      setSaving(false);
    }
  }

  // pull the built-in template into the editor so it can be edited without
  // saving first. this is a local-only fill; Save commits it.
  async function loadDefaultPrompt() {
    try {
      const { template } = await botsApi.getDefaultSystemPrompt();
      setSystemPrompt(template);
      toast.show("Default template loaded. Save to commit the override.", "info");
    } catch (err) {
      toast.show(`Failed to load default: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  async function importCard(text: string, filename: string) {
    try {
      const parsed = parseCharacterCard(text);
      if (!parsed.name && !parsed.description && !parsed.mesExample && !parsed.depthPrompt) {
        throw new Error("No character fields found in this file.");
      }
      // post the whole parsed card as-is; the server does the digging
      const check = tryParseJson(text);
      if (!check.ok) throw new Error("Invalid JSON");
      const res = await fetch(`/api/bots/${botId}/character/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "replace", card: check.value }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { character: Character };
      setChar(data.character);
      setName(data.character.name);
      setDescription(data.character.description);
      setMesExample(data.character.mesExample);        setSystemPrompt(data.character.systemPrompt ?? "");      setDepthPromptText(data.character.depthPrompt?.prompt ?? "");
      setDepthPromptDepth(data.character.depthPrompt?.depth ?? 2);
      toast.show(`Imported "${data.character.name}" from ${filename}`, "success");
    } catch (err) {
      toast.show(`Import failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  if (loading) return <LoadingState label="Loading character..." />;
  if (!char) return <p>Character not found.</p>;

  return (
    <div>
      <div class="editor-toolbar">
        <p class="field-hint" style={{ margin: 0 }}>
          <FileText size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />
          Character edits apply live to a running bot. No restart needed.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <ImportButton label="Import character.json" onFile={importCard} />
          <Button onClick={save} loading={saving} disabled={saving}>
            <Save size={15} />
            Save character
          </Button>
        </div>
      </div>

      <Field
        label="Name"
        name="name"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        hint="The character's display name. Also matches as a trigger keyword in chat."
      />

      <TextArea
        label="Description"
        name="description"
        value={description}
        onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
        rows={12}
        hint="The main character definition. Markdown ok. This becomes the system prompt's core lore."
      />

      <TextArea
        label="Message examples"
        name="mesExample"
        value={mesExample}
        onInput={(e) => setMesExample((e.target as HTMLTextAreaElement).value)}
        rows={6}
        mono
        hint="Example dialogue for the character to mimic. Optional."
      />

      {/* system prompt override */}
      <div class="setting-group">
        <div class="setting-group-title">System prompt (optional)</div>
        <p class="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Override the built-in prompt template for this character. Leave blank to use the default.
          Tokens like{" "}
          <code>{`{{user}}`}</code>, <code>{`{{char}}`}</code>, <code>{`{{description}}`}</code>,{" "}
          <code>{`{{availableCommands}}`}</code>, <code>{`{{lorebookEntries}}`}</code> are replaced at runtime.
        </p>
        <TextArea
          label="System prompt"
          name="systemPrompt"
          value={systemPrompt}
          onInput={(e) => setSystemPrompt((e.target as HTMLTextAreaElement).value)}
          rows={14}
          mono
          placeholder="(using the built-in default template)"
        />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
          <Button variant="ghost" size="sm" onClick={loadDefaultPrompt} disabled={saving}>
            <Download size={12} />
            Load default template
          </Button>
          <Button variant="ghost" size="sm" onClick={resetSystemPrompt} disabled={saving || !systemPrompt}>
            <RotateCcw size={12} />
            Reset to default
          </Button>
        </div>
      </div>

      <div class="setting-group">
        <div class="setting-group-title">Depth prompt</div>
        <div class="setting-row-grid">
          <Field
            label="Depth"
            name="depth"
            type="number"
            min={0}
            max={20}
            value={String(depthPromptDepth)}
            onInput={(e) => setDepthPromptDepth(Number((e.target as HTMLInputElement).value) || 0)}
            hint="Inserted N messages from the end of history."
          />
          <div class="field" style={{ marginBottom: 0 }}>
            <span class="field-label">Prompt</span>
            <span class="field-hint">High-priority instruction injected at that depth. Leave blank to disable.</span>
          </div>
        </div>
        <TextArea
          label="Prompt text"
          name="depthPrompt"
          value={depthPromptText}
          onInput={(e) => setDepthPromptText((e.target as HTMLTextAreaElement).value)}
          rows={3}
          mono
          placeholder="[Use the react command when you think of a fitting emoji.]"
        />
      </div>
    </div>
  );
}
