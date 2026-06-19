import { useEffect, useState } from "preact/hooks";
import { Bot as BotIcon, Plus, Play, Square, Pencil, Trash2, RefreshCw, Info } from "lucide-react";
import { Link } from "wouter";
import {
  bots,
  botsLoading,
  loadBots,
  createBot,
  deleteBot,
  startBot,
  stopBot,
  restartBot,
  pollStatus,
} from "../state/bots";
import { providers, loadProviders } from "../state/providers";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { Callout } from "../components/Callout";
import { ModelPicker } from "../components/ModelPicker";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingState, EmptyState } from "../components/State";
import type { BotCreateInput } from "../api/bots-types";

export function BotsListRoute() {
  useEffect(() => {
    void loadBots();
    void loadProviders();
  }, []);

  return (
    <section>
      <div class="list-card">
        <div class="list-header">
          <h2>
            Bots <span class="count-pill">{bots.value.length}</span>
          </h2>
          <CreateButton />
        </div>

        {botsLoading.value ? (
          <LoadingState label="Loading bots..." />
        ) : bots.value.length === 0 ? (
          <EmptyState
            icon={<BotIcon size={32} />}
            title="No bots yet"
            subtitle="Create a bot with a Discord token. Wire it to an LLM provider and you're off."
            action={<CreateButton label="Create your first bot" />}
          />
        ) : (
          <div style={{ padding: "16px" }}>
            <div class="bot-grid">
              {bots.value.map((b) => (
                <BotCard key={b.id} bot={b} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function CreateButton({ label = "New bot" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={16} />
        {label}
      </Button>
      {open && <CreateModal onClose={() => setOpen(false)} />}
    </>
  );
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; token?: string }>({});

  useEffect(() => {
    // default to the first provider if there is one
    if (!providerId && providers.value.length > 0) setProviderId(providers.value[0]!.id);
  }, [providers.value]);

  async function submit(e: Event) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Name is required";
    if (!token.trim()) errs.token = "Discord bot token is required";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    // one name seeds both the bot label and the character's display name.
    // they can be diverged later from the Character tab if ever needed.
    const input: BotCreateInput = {
      name: name.trim(),
      discordToken: token.trim(),
      llmProviderId: providerId || undefined,
      llmModel: model.trim() || undefined,
      characterName: name.trim(),
    };
    const created = await createBot(input);
    setSaving(false);
    if (created) onClose();
  }

  return (
    <Modal
      open
      size="lg"
      title="New bot"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="bot-create-form" loading={saving} disabled={saving}>
            Create bot
          </Button>
        </>
      }
    >
      <form id="bot-create-form" onSubmit={submit}>
        <Field
          label="Name"
          name="name"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="My Assistant"
          hint="Used as both the bot label and the character's display name. Edit either later."
          error={errors.name}
          autoFocus
        />
        <Field
          label="Discord bot token"
          name="token"
          type="password"
          value={token}
          onInput={(e) => setToken((e.target as HTMLInputElement).value)}
          placeholder="MTk4NjIy..."
          hint="Stored locally, never sent anywhere but Discord."
          error={errors.token}
        />
        <Callout icon={<Info size={15} />} title="No token yet?">
          Create an app at the{" "}
          <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
            Discord Developer Portal
          </a>{" "}
          {"->"} pick your app {"->"} Bot {"->"} Reset Token. Then enable the{" "}
          <strong>Message Content</strong> and (if you want status in context){" "}
          <strong>Presence</strong> intents under Privileged Gateway Intents.
        </Callout>
        <div class="setting-row-grid">
          <div class="field">
            <label class="field-label" for="provider">
              LLM provider
            </label>
            <select
              id="provider"
              class="field-input"
              value={providerId}
              onChange={(e) => {
                setProviderId((e.target as HTMLSelectElement).value);
                setModel("");
              }}
            >
              <option value="">(none yet)</option>
              {providers.value.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
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
      </form>
    </Modal>
  );
}

function BotCard({ bot }: { bot: (typeof bots.value)[number] }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const running = bot.status === "online" || bot.status === "starting";

  return (
    <div class="bot-card">
      <div class="bot-card-header">
        <div style={{ minWidth: 0 }}>
          <h3 class="bot-card-name">
            <Link href={`/bots/${bot.id}`} class="muted-link">
              {bot.name}
            </Link>
          </h3>
          <div class="bot-card-meta">
            {bot.llmModel || "no model"} - {bot.discordTokenMasked || "no token"}
          </div>
        </div>
        <StatusBadge status={bot.status} detail={bot.detail} />
      </div>

      {bot.detail && bot.status === "error" && (
        <div class="list-row-error">{bot.detail}</div>
      )}

      <div class="bot-card-actions">
        {running ? (
          <Button variant="subtle" size="sm" onClick={() => void stopBot(bot.id)}>
            <Square size={14} />
            Stop
          </Button>
        ) : (
          <Button
            variant="subtle"
            size="sm"
            onClick={async () => {
              if (await startBot(bot.id)) pollStatus(bot.id);
            }}
          >
            <Play size={14} />
            Start
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (await restartBot(bot.id)) pollStatus(bot.id);
          }}
          disabled={!running}
          aria-label="Restart"
        >
          <RefreshCw size={14} />
        </Button>
        <Link href={`/bots/${bot.id}`}>
          <Button variant="ghost" size="sm" aria-label="Edit">
            <Pencil size={14} />
          </Button>
        </Link>
        <Button variant="danger" size="sm" onClick={() => setConfirmDel(true)} aria-label="Delete">
          <Trash2 size={14} />
        </Button>
      </div>

      {confirmDel && (
        <Modal
          open
          title={`Delete "${bot.name}"?`}
          onClose={() => setConfirmDel(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDel(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  if (await deleteBot(bot.id)) setConfirmDel(false);
                }}
              >
                <Trash2 size={15} />
                Delete
              </Button>
            </>
          }
        >
          <p>
            This stops the bot if it's running and deletes its config, character, memory, and metadata.
            Cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}
