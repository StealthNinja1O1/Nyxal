// bot extensions: comfyui + websearch (and later MCP servers).
// - assign a shared comfyui workflow (selectable from the global list)
// - comfyui connection + image gen settings (the comfyui blob)
// - websearch settings (the websearch blob)
// - MCP placeholder (coming later)
//
// all live-apply (no restart) per the hot-reload classifier. toggling
// websearch/comfyui on/off now also rebuilds the bot's advertised command
// list (see DiscordBot.applyConfigUpdate)

import { useEffect, useState } from "preact/hooks";
import { Save, ExternalLink, Plug } from "lucide-react";
import { Link } from "wouter";
import type { Bot } from "../../api/bots-types";
import type { ComfyUiConfig, WebSearchConfig } from "@shared/types";
import { updateBot } from "../../state/bots";
import { workflows, loadWorkflows } from "../../state/workflows";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Toggle } from "../../components/Toggle";
import { LoadingState } from "../../components/State";

export function ExtensionsTab({ bot }: { bot: Bot }) {
  const [workflowId, setWorkflowId] = useState<string>(bot.comfyuiWorkflowId ?? "");
  const [comfyui, setComfyui] = useState<ComfyUiConfig>(bot.comfyui);
  const [websearch, setWebsearch] = useState<WebSearchConfig>(bot.websearch);
  const [saving, setSaving] = useState<false | "comfyui" | "websearch" | "workflow">(false);

  useEffect(() => {
    if (workflows.value.length === 0) void loadWorkflows();
  }, []);

  // reseed when the bot row changes after a save
  useEffect(() => {
    setWorkflowId(bot.comfyuiWorkflowId ?? "");
    setComfyui(bot.comfyui);
    setWebsearch(bot.websearch);
  }, [bot.updatedAt]);

  function setComfy<K extends keyof ComfyUiConfig>(k: K, v: ComfyUiConfig[K]) {
    setComfyui((c) => ({ ...c, [k]: v }));
  }
  function setSearch<K extends keyof WebSearchConfig>(k: K, v: WebSearchConfig[K]) {
    setWebsearch((s) => ({ ...s, [k]: v }));
  }

  async function saveWorkflow() {
    setSaving("workflow");
    await updateBot(bot.id, { comfyuiWorkflowId: workflowId || null }, { silent: true });
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

  return (
    <div>
      {/* workflow assignment */}
      <div class="setting-group">
        <div class="setting-group-title">Workflow</div>
        <div class="field">
          <label class="field-label" for="workflow">Assigned workflow</label>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <select
              id="workflow"
              class="field-input"
              value={workflowId}
              onChange={(e) => setWorkflowId((e.target as HTMLSelectElement).value)}
            >
              <option value="">(none)</option>
              {workflows.value.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <Button variant="subtle" size="sm" onClick={saveWorkflow} loading={saving === "workflow"}>
              <Save size={14} /> Save
            </Button>
          </div>
          {workflowId && (
            <p class="field-hint" style={{ marginTop: 6 }}>
              <Link href={`/workflows/${workflowId}`} class="muted-link">
                Edit this workflow's text nodes <ExternalLink size={11} style={{ verticalAlign: "middle" }} />
              </Link>
            </p>
          )}
          {workflows.value.length === 0 && (
            <p class="field-hint" style={{ marginTop: 6 }}>
              No workflows yet.{" "}
              <Link href="/workflows" class="muted-link">Create one first</Link>.
            </p>
          )}
        </div>
      </div>

      {/* comfyui connection + image gen */}
      <div class="setting-group">
        <div class="setting-group-title">ComfyUI server</div>
        <Toggle
          label="Enable image generation"
          hint="Lets the bot use the generateImage command."
          checked={comfyui.enabled}
          onChange={(v) => setComfy("enabled", v)}
        />
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
        <Toggle
          label="Enable web search tools"
          hint="Enables webSearch, fetchWebpage, searchAndFetch, deepResearch, crawlSite commands."
          checked={websearch.enabled}
          onChange={(v) => setSearch("enabled", v)}
        />
        <Field
          label="Miyami base URL"
          name="searchBaseUrl"
          value={websearch.baseUrl}
          onInput={(e) => setSearch("baseUrl", (e.target as HTMLInputElement).value)}
          placeholder="https://websearch.miyami.tech"
          hint="Self-host with: docker run -p 8080:8080 searxng-api"
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

      {/* MCP servers - placeholder for the future. the tab is structured so
          MCP can slot in alongside comfyui + websearch without a restructure. */}
      <div class="setting-group">
        <div class="setting-group-title">MCP servers</div>
        <div class="ext-placeholder">
          <Plug size={20} style={{ marginBottom: 6, opacity: 0.6 }} />
          <div>
            <strong>Model Context Protocol</strong> support is coming.
          </div>
          <div style={{ marginTop: 4 }}>
            Hook up external tool servers (filesystem, browser, databases) and expose their tools to the bot.
          </div>
        </div>
      </div>
    </div>
  );
}
