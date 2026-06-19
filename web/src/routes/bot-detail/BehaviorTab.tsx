import { useEffect, useState } from "preact/hooks";
import { Save, AlertTriangle, RotateCw, Info } from "lucide-react";
import type { Bot, BotPatch } from "../../api/bots-types";
import type { BotStatusConfig } from "@shared/types";
import { updateBot, restartBot, pollStatus } from "../../state/bots";
import { providers } from "../../state/providers";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Toggle } from "../../components/Toggle";
import { Callout } from "../../components/Callout";
import { ModelPicker } from "../../components/ModelPicker";

export function BehaviorTab({ bot }: { bot: Bot }) {
  // local editable state, seeded from the bot row
  const [token, setToken] = useState("");
  const [providerId, setProviderId] = useState(bot.llmProviderId ?? "");
  const [model, setModel] = useState(bot.llmModel);
  const [temperature, setTemperature] = useState(bot.temperature);
  const [visionProviderId, setVisionProviderId] = useState(bot.visionProviderId ?? "");
  const [visionModel, setVisionModel] = useState(bot.visionModel ?? "");
  const [channelIds, setChannelIds] = useState(bot.channelIds.join(", "));
  const [allowedUserIds, setAllowedUserIds] = useState(bot.allowedUserIds.join(", "));
  const [triggerKeywords, setTriggerKeywords] = useState(bot.triggerKeywords.join(", "));
  const [randomRate, setRandomRate] = useState(bot.randomResponseRate);
  const [maxHistory, setMaxHistory] = useState(bot.maxHistoryMessages);
  const [maxTokens, setMaxTokens] = useState(bot.maxContextTokens);
  const [minInterval, setMinInterval] = useState(bot.minResponseIntervalSeconds);
  const [maxRecursion, setMaxRecursion] = useState(bot.maxRecursionDepth);
  const [logLevel, setLogLevel] = useState(bot.logLevel);

  // presence / activity blob (status) - edited in its own section, saved
  // separately from the main behavior patch since it's a nested blob.
  const [status, setStatus] = useState<BotStatusConfig>(bot.statusCfg);
  const [savingStatus, setSavingStatus] = useState(false);

  const [toggles, setToggles] = useState({
    ignoreOtherBots: bot.ignoreOtherBots,
    replyToMentions: bot.replyToMentions,
    addTimestamps: bot.addTimestamps,
    addNothink: bot.addNothink,
    enableUserStatus: bot.enableUserStatus,
    allowRenaming: bot.allowRenaming,
    allowLorebookEditing: bot.allowLorebookEditing,
    enableVision: bot.enableVision,
  });

  const [saving, setSaving] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [restartReasons, setRestartReasons] = useState<string[]>([]);

  // reseed token display when the bot's masked token changes after a save
  useEffect(() => {
    setToken("");
    setStatus(bot.statusCfg);
  }, [bot.updatedAt]);

  function setStatusField<K extends keyof BotStatusConfig>(k: K, v: BotStatusConfig[K]) {
    setStatus((s) => ({ ...s, [k]: v }));
  }

  function setT<K extends keyof typeof toggles>(key: K, value: boolean) {
    setToggles((t) => ({ ...t, [key]: value }));
  }

  async function save() {
    setSaving(true);
    // build a patch only with changed/meaningful fields
    const patch: BotPatch = {
      llmProviderId: providerId || undefined,
      llmModel: model,
      temperature,
      visionProviderId: visionProviderId || undefined,
      visionModel: visionModel || undefined,
      enableVision: toggles.enableVision,
      channelIds: parseIds(channelIds),
      allowedUserIds: parseIds(allowedUserIds),
      triggerKeywords: parseList(triggerKeywords),
      randomResponseRate: randomRate,
      maxHistoryMessages: maxHistory,
      maxContextTokens: maxTokens,
      minResponseIntervalSeconds: minInterval,
      maxRecursionDepth: maxRecursion,
      logLevel,
      ignoreOtherBots: toggles.ignoreOtherBots,
      replyToMentions: toggles.replyToMentions,
      addTimestamps: toggles.addTimestamps,
      addNothink: toggles.addNothink,
      enableUserStatus: toggles.enableUserStatus,
      allowRenaming: toggles.allowRenaming,
      allowLorebookEditing: toggles.allowLorebookEditing,
    };
    if (token.trim()) patch.discordToken = token.trim();

    const result = await updateBot(bot.id, patch);
    setSaving(false);
    if (result) {
      setRestartRequired(result.restartRequired);
      setRestartReasons(result.reasons);
    }
  }

  async function saveStatus() {
    setSavingStatus(true);
    await updateBot(bot.id, { status }, { silent: true });
    setSavingStatus(false);
  }

  async function doRestart() {
    const ok = await restartBot(bot.id);
    if (ok) {
      pollStatus(bot.id);
      setRestartRequired(false);
      setRestartReasons([]);
    }
  }

  return (
    <div>
      {restartRequired && (
        <div class="restart-banner">
          <div class="restart-banner-text">
            <AlertTriangle size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />
            <strong>Restart required</strong>
            {restartReasons.length > 0 && ` - ${restartReasons.join("; ")}`}
          </div>
          <Button size="sm" onClick={doRestart}>
            <RotateCw size={14} />
            Restart now
          </Button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Button onClick={save} loading={saving} disabled={saving}>
          <Save size={15} />
          Save behavior
        </Button>
      </div>

      {/* connection (token + intents need reconnect) */}
      <div class="setting-group">
        <div class="setting-group-title">Discord connection</div>
        <Field
          label={`Bot token${bot.hasToken ? " (leave blank to keep current)" : ""}`}
          name="token"
          type="password"
          value={token}
          onInput={(e) => setToken((e.target as HTMLInputElement).value)}
          placeholder={bot.hasToken ? bot.discordTokenMasked : "MTk4NjIy..."}
          hint={bot.hasToken ? `Stored as ${bot.discordTokenMasked}. Changing this needs a reconnect.` : "From the Discord Developer Portal."}
        />
        <Callout icon={<Info size={15} />} title="Need a token?">
          Grab one from the{" "}
          <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
            Discord Developer Portal
          </a>{" "}
          {"->"} your app {"->"} Bot {"->"} Reset Token. While you're there, enable the{" "}
          <strong>Message Content</strong> intent (required) and{" "}
          <strong>Presence</strong> if you want user status in context.
        </Callout>
        <Toggle
          label="Presence intent (user status in context)"
          hint="Adds user Discord status/activity to the LLM context. Needs a reconnect when toggled."
          checked={toggles.enableUserStatus}
          onChange={(v) => setT("enableUserStatus", v)}
        />
      </div>

      {/* llm / vision (live) */}
      <div class="setting-group">
        <div class="setting-group-title">LLM + vision (live)</div>
        <div class="setting-row-grid">
          <div class="field">
            <label class="field-label" for="provider">LLM provider</label>
            <select
              id="provider"
              class="field-input"
              value={providerId}
              onChange={(e) => {
                setProviderId((e.target as HTMLSelectElement).value);
                setModel("");
              }}
            >
              <option value="">(none)</option>
              {providers.value.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <p class="field-hint">Models load from the provider's /v1/models.</p>
          </div>
          <ModelPicker
            label="Model"
            providerId={providerId || null}
            value={model}
            onChange={setModel}
            placeholder="gpt-4o"
          />
        </div>
        <div class="setting-row-grid">
          <Field
            label="Temperature"
            name="temperature"
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={String(temperature)}
            onInput={(e) => setTemperature(Number((e.target as HTMLInputElement).value) || 0)}
          />
          <div class="field" />
        </div>

        <Toggle
          label="Enable vision"
          hint="Pass images to a vision-capable model. Configure the model below."
          checked={toggles.enableVision}
          onChange={(v) => setT("enableVision", v)}
        />
        {toggles.enableVision && (
          <div class="setting-row-grid">
            <div class="field">
              <label class="field-label" for="vprovider">Vision provider</label>
              <select
                id="vprovider"
                class="field-input"
                value={visionProviderId}
                onChange={(e) => {
                  setVisionProviderId((e.target as HTMLSelectElement).value);
                  setVisionModel("");
                }}
              >
                <option value="">(use main provider)</option>
                {providers.value.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <p class="field-hint">Falls back to the main provider if unset.</p>
            </div>
            <ModelPicker
              label="Vision model"
              providerId={visionProviderId || null}
              fallbackProviderId={providerId || null}
              value={visionModel ?? ""}
              onChange={setVisionModel}
              placeholder="gpt-4o-mini"
            />
          </div>
        )}
      </div>

      {/* triggers / channels */}
      <div class="setting-group">
        <div class="setting-group-title">Triggers + channels</div>
        <Field
          label="Channel IDs (comma separated)"
          name="channelIds"
          value={channelIds}
          onInput={(e) => setChannelIds((e.target as HTMLInputElement).value)}
          hint="Empty = respond in all channels the bot can see."
        />
        <div class="setting-row-grid">
          <Field
            label="Trigger keywords (comma separated)"
            name="triggerKeywords"
            value={triggerKeywords}
            onInput={(e) => setTriggerKeywords((e.target as HTMLInputElement).value)}
            hint="Full-word matches that wake the bot."
          />
          <Field
            label="Admin user IDs (comma separated)"
            name="allowedUserIds"
            value={allowedUserIds}
            onInput={(e) => setAllowedUserIds((e.target as HTMLInputElement).value)}
            hint="Users allowed to run slash commands."
          />
        </div>
        <Toggle
          label="Reply to mentions"
          hint="Respond when mentioned or when the character name is said."
          checked={toggles.replyToMentions}
          onChange={(v) => setT("replyToMentions", v)}
        />
        <Toggle
          label="Ignore other bots"
          checked={toggles.ignoreOtherBots}
          onChange={(v) => setT("ignoreOtherBots", v)}
        />
      </div>

      {/* context budget */}
      <div class="setting-group">
        <div class="setting-group-title">Context budget</div>
        <div class="setting-row-grid">
          <Field
            label="Random response rate (1 in N)"
            name="randomRate"
            type="number"
            min="0"
            value={String(randomRate)}
            onInput={(e) => setRandomRate(Number((e.target as HTMLInputElement).value) || 0)}
            hint="0 disables random responses."
          />
          <Field
            label="Max history messages"
            name="maxHistory"
            type="number"
            min="1"
            max="100"
            value={String(maxHistory)}
            onInput={(e) => setMaxHistory(Number((e.target as HTMLInputElement).value) || 1)}
          />
        </div>
        <div class="setting-row-grid">
          <Field
            label="Max context tokens"
            name="maxTokens"
            type="number"
            min="1000"
            value={String(maxTokens)}
            onInput={(e) => setMaxTokens(Number((e.target as HTMLInputElement).value) || 1000)}
          />
          <Field
            label="Min response interval (seconds)"
            name="minInterval"
            type="number"
            min="0"
            value={String(minInterval)}
            onInput={(e) => setMinInterval(Number((e.target as HTMLInputElement).value) || 0)}
            hint="Per-channel cooldown."
          />
        </div>
        <div class="setting-row-grid">
          <Field
            label="Max recursion depth"
            name="maxRecursion"
            type="number"
            min="1"
            max="10"
            value={String(maxRecursion)}
            onInput={(e) => setMaxRecursion(Number((e.target as HTMLInputElement).value) || 1)}
            hint="Max LLM turns per message (for web search loops)."
          />
          <div class="field">
            <label class="field-label" for="logLevel">Log level</label>
            <select
              id="logLevel"
              class="field-input"
              value={logLevel}
              onChange={(e) => setLogLevel((e.target as HTMLSelectElement).value)}
            >
              <option value="DEBUG">DEBUG</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>
        </div>
      </div>

      {/* behaviour toggles */}
      <div class="setting-group">
        <div class="setting-group-title">Behaviour</div>
        <Toggle
          label="Add timestamps"
          hint="Appends ISO timestamps to messages in context."
          checked={toggles.addTimestamps}
          onChange={(v) => setT("addTimestamps", v)}
        />
        <Toggle
          label="Add nothink tag"
          hint="Disables thinking for models that support it."
          checked={toggles.addNothink}
          onChange={(v) => setT("addNothink", v)}
        />
        <Toggle
          label="Allow renaming"
          hint="Lets the bot rename itself / others via commands."
          checked={toggles.allowRenaming}
          onChange={(v) => setT("allowRenaming", v)}
        />
        <Toggle
          label="Allow lorebook editing"
          hint="Lets the bot create/update memory entries via editOrAddToLorebook."
          checked={toggles.allowLorebookEditing}
          onChange={(v) => setT("allowLorebookEditing", v)}
        />
      </div>

      {/* presence / activity (the discord.status blob, live) */}
      <div class="setting-group">
        <div class="setting-group-title">Presence / activity</div>
        <p class="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
          What the bot shows as its Discord activity in each state. Live-apply (no restart).
        </p>

        {/* idle */}
        <div class="setting-row-grid">
          <Field
            label="Idle activity text"
            name="idleText"
            value={status.idleText ?? ""}
            onInput={(e) => setStatusField("idleText", (e.target as HTMLInputElement).value || null)}
            placeholder="(no activity shown)"
            hint="Shown when online + not working. Blank = no activity."
          />
          <ActivityTypeSelect
            label="Idle activity type"
            value={status.idleType}
            onChange={(v) => setStatusField("idleType", v)}
          />
        </div>

        {/* generating */}
        <div class="setting-row-grid">
          <Field
            label="Generating activity text"
            name="generatingText"
            value={status.generatingText}
            onInput={(e) => setStatusField("generatingText", (e.target as HTMLInputElement).value)}
            placeholder="painting a masterpiece"
            hint="Shown while an image is being generated. Status is forced to do-not-disturb."
          />
          <ActivityTypeSelect
            label="Generating activity type"
            value={status.generatingType}
            onChange={(v) => setStatusField("generatingType", v)}
          />
        </div>

        {/* disabled (toggled off via /togglebot) */}
        <div class="setting-row-grid">
          <Field
            label="Disabled activity text"
            name="disabledText"
            value={status.disabledText}
            onInput={(e) => setStatusField("disabledText", (e.target as HTMLInputElement).value)}
            placeholder="on hiatus"
            hint="Shown when the bot is toggled off with /togglebot."
          />
          <ActivityTypeSelect
            label="Disabled activity type"
            value={status.disabledType}
            onChange={(v) => setStatusField("disabledType", v)}
          />
        </div>
        <div class="field">
          <label class="field-label" for="disabledStatus">Disabled online status</label>
          <select
            id="disabledStatus"
            class="field-input"
            value={status.disabledStatus}
            onChange={(e) => setStatusField("disabledStatus", (e.target as HTMLSelectElement).value)}
          >
            <option value="online">online</option>
            <option value="idle">idle</option>
            <option value="dnd">dnd (do not disturb)</option>
            <option value="invisible">invisible</option>
          </select>
          <p class="field-hint">Discord presence color while disabled.</p>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Button onClick={saveStatus} loading={savingStatus} disabled={savingStatus}>
            <Save size={15} /> Save presence
          </Button>
        </div>
      </div>
    </div>
  );
}

function ActivityTypeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div class="field">
      <label class="field-label">{label}</label>
      <select
        class="field-input"
        value={value}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        <option value="Playing">Playing</option>
        <option value="Streaming">Streaming</option>
        <option value="Listening">Listening</option>
        <option value="Watching">Watching</option>
        <option value="Competing">Competing</option>
      </select>
    </div>
  );
}

function parseIds(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function parseList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}
