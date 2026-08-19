// bot extensions: comfyui + websearch.
// - assign one or more shared comfyui workflows + pick a default
// - comfyui connection + image gen settings (the comfyui blob, incl. dynamic resolutions)
// - websearch settings (the websearch blob)
//
// all live-apply (no restart) per the hot-reload classifier. toggling
// websearch/comfyui on/off now also rebuilds the bot's advertised command
// list (see DiscordBot.applyConfigUpdate)

import { useEffect, useState } from "preact/hooks";
import { Save, ExternalLink, Plus, Trash2, Star, X } from "lucide-react";
import { Link } from "wouter";
import type { Bot } from "../../api/bots-types";
import type { ComfyUiConfig, WebSearchConfig, SummaryConfig, ComfyResolution } from "@shared/types";
import { updateBot } from "../../state/bots";
import { workflows, loadWorkflows } from "../../state/workflows";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Toggle } from "../../components/Toggle";

export function ExtensionsTab({ bot }: { bot: Bot }) {
  const [workflowIds, setWorkflowIds] = useState<string[]>(bot.comfyuiWorkflowIds ?? []);
  const [defaultWorkflowId, setDefaultWorkflowId] = useState<string | null>(
    bot.comfyuiDefaultWorkflowId,
  );
  const [comfyui, setComfyui] = useState<ComfyUiConfig>(bot.comfyui);
  const [websearch, setWebsearch] = useState<WebSearchConfig>(bot.websearch);
  const [summary, setSummary] = useState<SummaryConfig>(bot.summary);
  const [saving, setSaving] = useState<false | "comfyui" | "websearch" | "summary" | "workflow">(false);

  useEffect(() => {
    if (workflows.value.length === 0) void loadWorkflows();
  }, []);

  // reseed when the bot row changes after a save
  useEffect(() => {
    setWorkflowIds(bot.comfyuiWorkflowIds ?? []);
    setDefaultWorkflowId(bot.comfyuiDefaultWorkflowId);
    setComfyui(bot.comfyui);
    setWebsearch(bot.websearch);
    setSummary(bot.summary);
  }, [bot.updatedAt]);

  function setComfy<K extends keyof ComfyUiConfig>(k: K, v: ComfyUiConfig[K]) {
    setComfyui((c) => ({ ...c, [k]: v }));
  }
  function setSearch<K extends keyof WebSearchConfig>(k: K, v: WebSearchConfig[K]) {
    setWebsearch((s) => ({ ...s, [k]: v }));
  }
  function setSumm<K extends keyof SummaryConfig>(k: K, v: SummaryConfig[K]) {
    setSummary((s) => ({ ...s, [k]: v }));
  }

  // ---- workflow assignment helpers ----
  const assignedWorkflows = workflowIds
    .map((id) => workflows.value.find((w) => w.id === id))
    .filter((w): w is NonNullable<typeof w> => !!w);
  const unassignedWorkflows = workflows.value.filter((w) => !workflowIds.includes(w.id));

  function assignWorkflow(id: string) {
    setWorkflowIds((ids) => [...ids, id]);
    // auto-pick default if none set yet
    if (!defaultWorkflowId) setDefaultWorkflowId(id);
  }
  function unassignWorkflow(id: string) {
    setWorkflowIds((ids) => ids.filter((x) => x !== id));
    if (defaultWorkflowId === id) {
      const remaining = workflowIds.filter((x) => x !== id);
      setDefaultWorkflowId(remaining[0] ?? null);
    }
  }

  async function saveWorkflow() {
    setSaving("workflow");
    await updateBot(
      bot.id,
      { comfyuiWorkflowIds: workflowIds, comfyuiDefaultWorkflowId: defaultWorkflowId },
      { silent: true },
    );
    setSaving(false);
  }
  async function saveComfy() {
    setSaving("comfyui");
    await updateBot(bot.id, { comfyui }, { silent: true });
    setSaving(false);
  }
  async function saveSearch() {
    setSaving("websearch");
    await updateBot(bot.id, { websearch }, { silent: true });
    setSaving(false);
  }
  async function saveSummary() {
    setSaving("summary");
    await updateBot(bot.id, { summary }, { silent: true });
    setSaving(false);
  }

  // ---- resolution editor helpers ----
  function setResolution(idx: number, patch: Partial<ComfyResolution>) {
    setComfyui((c) => ({
      ...c,
      resolutions: c.resolutions.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  }
  function addResolution() {
    setComfyui((c) => ({
      ...c,
      resolutions: [...c.resolutions, { name: "new", width: 1024, height: 1024 }],
    }));
  }
  function removeResolution(idx: number) {
    setComfyui((c) => ({
      ...c,
      resolutions: c.resolutions.filter((_, i) => i !== idx),
    }));
  }

  return (
    <div>
      {/* workflow assignment */}
      <div class="setting-group">
        <div class="setting-group-title">Workflows</div>
        <p class="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Assign one or more workflows. The default (starred) is used unless the LLM overrides it. The bot's
          context lists all assigned workflows by name so the LLM can pick one.
        </p>

        {assignedWorkflows.length === 0 && workflows.value.length === 0 ? (
          <p class="field-hint">
            No workflows yet.{" "}
            <Link href="/workflows" class="muted-link">Create one first</Link>.
          </p>
        ) : (
          <>
            {assignedWorkflows.map((w) => (
              <div class="workflow-assign-row" key={w.id}>
                <button
                  type="button"
                  class={`icon-btn star-btn ${defaultWorkflowId === w.id ? "active" : ""}`}
                  onClick={() => setDefaultWorkflowId(w.id)}
                  title={defaultWorkflowId === w.id ? "Default workflow" : "Set as default"}
                  aria-label="Set as default"
                >
                  <Star size={15} fill={defaultWorkflowId === w.id ? "currentColor" : "none"} />
                </button>
                <div class="workflow-assign-info">
                  <span class="workflow-assign-name">{w.name}</span>
                  {w.description && <span class="workflow-assign-desc">{w.description}</span>}
                </div>
                <Link href={`/workflows/${w.id}`} class="icon-btn" title="Edit workflow">
                  <ExternalLink size={14} />
                </Link>
                <button
                  type="button"
                  class="icon-btn danger"
                  onClick={() => unassignWorkflow(w.id)}
                  title="Unassign"
                  aria-label="Unassign"
                >
                  <X size={15} />
                </button>
              </div>
            ))}

            {unassignedWorkflows.length > 0 && (
              <div class="workflow-add-row">
                <select
                  class="field-input"
                  value=""
                  onChange={(e) => {
                    const v = (e.target as HTMLSelectElement).value;
                    if (v) assignWorkflow(v);
                    (e.target as HTMLSelectElement).value = "";
                  }}
                >
                  <option value="">+ assign a workflow...</option>
                  {unassignedWorkflows.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Button onClick={saveWorkflow} loading={saving === "workflow"}>
            <Save size={15} /> Save workflows
          </Button>
        </div>
      </div>

      {/* comfyui connection + image gen */}
      <div class="setting-group">
        <div class="setting-group-title">ComfyUI server</div>
        <p class="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Image generation enables automatically when a base URL and at least one workflow are set. Toggle it per-tool on the Tools tab.
        </p>
        <Field
          label="ComfyUI base URL"
          name="comfyBaseUrl"
          value={comfyui.baseUrl}
          onInput={(e) => setComfy("baseUrl", (e.target as HTMLInputElement).value)}
          placeholder="http://127.0.0.1:8188"
          hint="Your ComfyUI instance URL."
        />
        <div class="setting-row-grid">
          <Field
            label="Timeout (seconds)"
            name="timeout"
            type="number"
            min="10"
            value={String(comfyui.timeoutSeconds)}
            onInput={(e) => setComfy("timeoutSeconds", Number((e.target as HTMLInputElement).value) || 120)}
          />
          <Field
            label="Poll interval (ms)"
            name="poll"
            type="number"
            min="500"
            value={String(comfyui.pollIntervalMs)}
            onInput={(e) => setComfy("pollIntervalMs", Number((e.target as HTMLInputElement).value) || 2000)}
          />
        </div>

        {/* dynamic resolutions editor */}
        <div class="setting-subgroup">
          <div class="setting-subgroup-title">
            Resolutions
            <button type="button" class="icon-btn" onClick={addResolution} title="Add resolution" aria-label="Add resolution">
              <Plus size={14} />
            </button>
          </div>
          <p class="field-hint" style={{ marginTop: 0, marginBottom: 8 }}>
            The LLM picks from these by name. The first one is the default. Names should be unique lowercase identifiers.
          </p>
          {comfyui.resolutions.map((r, i) => (
            <div class="resolution-row" key={i}>
              <input
                class="field-input resolution-name"
                type="text"
                value={r.name}
                placeholder="square"
                onInput={(e) => setResolution(i, { name: (e.target as HTMLInputElement).value })}
              />
              <input
                class="field-input resolution-dim"
                type="number"
                min="64"
                value={String(r.width)}
                onInput={(e) => setResolution(i, { width: Number((e.target as HTMLInputElement).value) || 0 })}
                aria-label="Width"
              />
              <span class="resolution-x">x</span>
              <input
                class="field-input resolution-dim"
                type="number"
                min="64"
                value={String(r.height)}
                onInput={(e) => setResolution(i, { height: Number((e.target as HTMLInputElement).value) || 0 })}
                aria-label="Height"
              />
              <button
                type="button"
                class="icon-btn danger"
                onClick={() => removeResolution(i)}
                title="Remove"
                aria-label="Remove resolution"
                disabled={comfyui.resolutions.length <= 1}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        <Toggle
          label="Randomize seeds"
          hint="Replaces every `seed` input in the workflow with a fresh random value per gen."
          checked={comfyui.randomizeSeeds}
          onChange={(v) => setComfy("randomizeSeeds", v)}
        />
        <Toggle
          label="Strip PNG metadata"
          hint="Removes prompt/workflow text chunks from the generated PNG."
          checked={comfyui.stripMetadata}
          onChange={(v) => setComfy("stripMetadata", v)}
        />
        <Toggle
          label="Include prompt in message"
          hint="Shows the prompt text alongside the generated image."
          checked={comfyui.includePromptInMessage}
          onChange={(v) => setComfy("includePromptInMessage", v)}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Button onClick={saveComfy} loading={saving === "comfyui"}>
            <Save size={15} /> Save ComfyUI
          </Button>
        </div>
      </div>

      {/* websearch */}
      <div class="setting-group">
        <div class="setting-group-title">Web search (Miyami API)</div>
        <p class="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Web search tools enable automatically when a base URL is set. Toggle each one per-tool on the Tools tab.
        </p>
        <Field
          label="Miyami base URL"
          name="searchBaseUrl"
          value={websearch.baseUrl}
          onInput={(e) => setSearch("baseUrl", (e.target as HTMLInputElement).value)}
          placeholder="https://your-miyami-instance"
          hint="Self-host: Look at https://github.com/ankushthakur2007/miyami_websearch_tool. Basic auth with user:pass@... supported."
        />
        <div class="setting-row-grid">
          <div class="field">
            <label class="field-label" for="searchLang">Language</label>
            <select
              id="searchLang"
              class="field-input"
              value={websearch.language}
              onChange={(e) => setSearch("language", (e.target as HTMLSelectElement).value)}
            >
              <option value="auto">auto</option>
              <option value="en">en</option>
              <option value="de">de</option>
              <option value="fr">fr</option>
              <option value="es">es</option>
              <option value="ja">ja</option>
            </select>
          </div>
          <Field
            label="Max results"
            name="maxResults"
            type="number"
            min="1"
            max="20"
            value={String(websearch.maxResults)}
            onInput={(e) => setSearch("maxResults", Number((e.target as HTMLInputElement).value) || 5)}
          />
        </div>
        <Toggle
          label="Auto bypass"
          hint="Auto-escalate stealth levels if blocked by websites."
          checked={websearch.autoBypass}
          onChange={(v) => setSearch("autoBypass", v)}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Button onClick={saveSearch} loading={saving === "websearch"}>
            <Save size={15} /> Save Web search
          </Button>
        </div>
      </div>

      {/* conversation summaries */}
      <div class="setting-group">
        <div class="setting-group-title">Conversation summaries</div>
        <p class="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Folds older messages into character-voice recaps that live in the cached system prompt, so the
          bot keeps far more context than the verbatim window alone. Summaries are written as the character,
          in first person, to preserve personality. Runs after each reply (no added latency).
        </p>
        <Toggle
          label="Enable summaries"
          hint="When off, messages past the rolling window are simply dropped (current behaviour)."
          checked={summary.enabled}
          onChange={(v) => setSumm("enabled", v)}
        />
        <div class="setting-row-grid">
          <Field
            label="Token threshold"
            name="summaryThresholdTokens"
            type="number"
            min="100"
            value={String(summary.summaryThresholdTokens)}
            onInput={(e) =>
              setSumm("summaryThresholdTokens", Number((e.target as HTMLInputElement).value) || 2000)
            }
            hint="Summarize once the pending span crosses this many tokens."
          />
          <Field
            label="Max summaries per chat"
            name="maxSummariesPerChat"
            type="number"
            min="1"
            value={String(summary.maxSummariesPerChat)}
            onInput={(e) =>
              setSumm("maxSummariesPerChat", Number((e.target as HTMLInputElement).value) || 10)
            }
            hint="Oldest is dropped (FIFO) when exceeded."
          />
        </div>
        <div class="setting-row-grid">
          <Field
            label="Rolling window (messages)"
            name="rollingWindowMessages"
            type="number"
            min="0"
            value={String(summary.rollingWindowMessages)}
            onInput={(e) =>
              setSumm("rollingWindowMessages", Number((e.target as HTMLInputElement).value) || 30)
            }
            hint="Most recent messages kept verbatim. Older fetched messages become summary input."
          />
          <Field
            label="Min summary tokens"
            name="minSummaryTokens"
            type="number"
            min="0"
            value={String(summary.minSummaryTokens)}
            onInput={(e) =>
              setSumm("minSummaryTokens", Number((e.target as HTMLInputElement).value) || 100)
            }
            hint="Never summarize spans below this. Skips spam/images/attachments."
          />
        </div>
        <div class="setting-row-grid">
          <Field
            label="Summary model"
            name="summaryModel"
            value={summary.summaryModel}
            onInput={(e) => setSumm("summaryModel", (e.target as HTMLInputElement).value)}
            placeholder="(reuse main model)"
            hint="Optional cheaper/faster model for summaries. Blank = reuse the bot's LLM model."
          />
          <Field
            label="Count fallback ratio"
            name="countFallbackRatio"
            type="number"
            min="0"
            step="0.1"
            value={String(summary.countFallbackRatio)}
            onInput={(e) =>
              setSumm("countFallbackRatio", Number((e.target as HTMLInputElement).value) || 0.5)
            }
            hint="If short msgs never reach the token bar, summarize at this fraction of max history. 0.5 = half. Set above 1 to disable."
          />
        </div>
        <p class="field-hint" style={{ marginTop: 8 }}>
          Example: threshold 2000, history 50, fallback 0.5. If 50 short messages total only 1200 tokens,
          a summary still fires at 25 messages (half of 50). Anything under 100 tokens is always skipped.
          Watch the bot logs for <code>[summary]</code> lines to fine-tune these values.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Button onClick={saveSummary} loading={saving === "summary"}>
            <Save size={15} /> Save Summaries
          </Button>
        </div>
      </div>
    </div>
  );
}
