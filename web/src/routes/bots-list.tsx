import { useEffect, useState } from "preact/hooks";
import { Bot as BotIcon, Plus, Play, Square, RefreshCw, Pencil, Trash2, Info, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Link, useLocation } from "wouter";
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
import type { Bot, BotCreateInput, BotStatus } from "../api/bots-types";

type SortKey = "name" | "status" | "model" | "provider" | "created";
type SortDir = "asc" | "desc";

export function BotsListRoute() {
  useEffect(() => {
    void loadBots();
    void loadProviders();
  }, []);

  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // resolve provider id -> name for display. fall back to id or "(none)".
  const providerName = (id: string | null): string => {
    if (!id) return "(none)";
    const p = providers.value.find((x) => x.id === id);
    return p?.name ?? id.slice(0, 8);
  };

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "created" ? "desc" : "asc");
    }
  }

  const sorted = [...bots.value].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "status":
        cmp = statusRank(a.status) - statusRank(b.status);
        break;
      case "model":
        cmp = (a.llmModel || "").localeCompare(b.llmModel || "");
        break;
      case "provider":
        cmp = providerName(a.llmProviderId).localeCompare(providerName(b.llmProviderId));
        break;
      case "created":
        cmp = a.createdAt - b.createdAt;
        break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

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
          <div style={{ overflowX: "auto" }}>
            <table class="data-table">
              <thead>
                <tr>
                  <SortableTh label="Name" k="name" cur={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="Status" k="status" cur={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="Model" k="model" cur={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="Provider" k="provider" cur={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="Created" k="created" cur={sortKey} dir={sortDir} onClick={toggleSort} />
                  <th class="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((b) => (
                  <BotRow key={b.id} bot={b} providerName={providerName(b.llmProviderId)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// online > starting > error > stopped > disabled, for a sensible default sort
function statusRank(s: BotStatus): number {
  switch (s) {
    case "online":
      return 0;
    case "starting":
      return 1;
    case "error":
      return 2;
    case "stopped":
      return 3;
    case "disabled":
      return 4;
  }
}

function SortableTh({
  label,
  k,
  cur,
  dir,
  onClick,
}: {
  label: string;
  k: SortKey;
  cur: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  const sorted = cur === k;
  return (
    <th class={`sortable ${sorted ? "sorted" : ""}`} onClick={() => onClick(k)}>
      {label}
      <span class="sort-ind">
        {sorted ? (
          dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        ) : (
          <ArrowUpDown size={12} />
        )}
      </span>
    </th>
  );
}

function BotRow({ bot, providerName }: { bot: Bot; providerName: string }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const running = bot.status === "online" || bot.status === "starting";
  const [, navigate] = useLocation();

  // row click navigates to detail. action buttons stopPropagation so they
  // don't trigger the navigation.
  function stopNav(e: Event) {
    e.stopPropagation();
  }

  return (
    <>
      <tr class={bot.status === "error" ? "is-error" : ""} onClick={() => navigate(`/bots/${bot.id}`)}>
        <td>
          <Link href={`/bots/${bot.id}`} class="muted-link" onClick={stopNav}>
            <strong>{bot.name}</strong>
          </Link>
        </td>
        <td>
          <StatusBadge status={bot.status} detail={bot.detail} />
        </td>
        <td class="col-mono">{bot.llmModel || "no model"}</td>
        <td class="col-mono">{providerName}</td>
        <td class="col-mono">{fmtDate(bot.createdAt)}</td>
        <td class="col-actions" onClick={stopNav}>
          <div class="row-actions">
            {running ? (
              <button
                class="row-action-btn"
                title="Stop"
                onClick={(e) => {
                  stopNav(e);
                  void stopBot(bot.id);
                }}
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                class="row-action-btn accent"
                title="Start"
                onClick={async (e) => {
                  stopNav(e);
                  if (await startBot(bot.id)) pollStatus(bot.id);
                }}
              >
                <Play size={14} />
              </button>
            )}
            <button
              class="row-action-btn"
              title="Restart"
              disabled={!running}
              onClick={async (e) => {
                stopNav(e);
                if (await restartBot(bot.id)) pollStatus(bot.id);
              }}
            >
              <RefreshCw size={14} />
            </button>
            <Link href={`/bots/${bot.id}`} class="row-action-btn" title="Edit">
              <Pencil size={14} />
            </Link>
            <button class="row-action-btn danger" title="Delete" onClick={(e) => { stopNav(e); setConfirmDel(true); }}>
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>

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
    </>
  );
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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


