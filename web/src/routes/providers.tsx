import { useEffect, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { KeyRound, Plus, Pencil, Trash2, Zap, ChevronDown, ChevronRight } from "lucide-react";
import {
  providers,
  providersLoading,
  loadProviders,
  createProvider,
  updateProvider,
  deleteProvider,
} from "../state/providers";
import { providersApi } from "../api/providers";
import type { Provider, TestResult } from "../api/types";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { Badge } from "../components/Badge";
import { LoadingState, EmptyState } from "../components/State";
import { Spinner } from "../components/State";

type EditorMode = { kind: "create" } | { kind: "edit"; provider: Provider } | null;
const editor = signal<EditorMode>(null);

/** Per-provider expanded model list (live-fetched on demand). */
const expandedModels = signal<Record<string, { loading: boolean; models?: string[]; error?: string }>>({});

export function ProvidersRoute() {
  useEffect(() => {
    void loadProviders();
  }, []);

  return (
    <section>
      <div class="list-card">
        <div class="list-header">
          <h2>
            LLM Providers <span class="count-pill">{providers.value.length}</span>
          </h2>
          <Button size="sm" onClick={() => (editor.value = { kind: "create" })}>
            <Plus size={16} />
            New provider
          </Button>
        </div>

        {providersLoading.value ? (
          <LoadingState label="Loading providers…" />
        ) : providers.value.length === 0 ? (
          <EmptyState
            icon={<KeyRound size={32} />}
            title="No providers yet"
            subtitle="Add an OpenAI-compatible endpoint. Models are fetched live when you pick one for a bot."
            action={
              <Button onClick={() => (editor.value = { kind: "create" })}>
                <Plus size={16} />
                Add your first provider
              </Button>
            }
          />
        ) : (
          <div>
            {providers.value.map((p) => (
              <ProviderRow key={p.id} provider={p} />
            ))}
          </div>
        )}
      </div>

      <ProviderEditor />
    </section>
  );
}

function ProviderRow({ provider }: { provider: Provider }) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const expanded = expandedModels.value[provider.id];

  async function onTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await providersApi.test(provider.id);
      setTestResult(r);
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  async function toggleModels() {
    if (expanded?.models) {
      // collapse
      const next = { ...expandedModels.value };
      delete next[provider.id];
      expandedModels.value = next;
      return;
    }
    expandedModels.value = { ...expandedModels.value, [provider.id]: { loading: true } };
    try {
      const r = await providersApi.models(provider.id);
      if ("error" in r && r.error) {
        expandedModels.value = { ...expandedModels.value, [provider.id]: { loading: false, error: r.error } };
      } else {
        expandedModels.value = {
          ...expandedModels.value,
          [provider.id]: { loading: false, models: r.models },
        };
      }
    } catch (err) {
      expandedModels.value = {
        ...expandedModels.value,
        [provider.id]: { loading: false, error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  return (
    <div class="list-row-wrap">
      <div class="list-row">
        <div class="list-row-main">
          <div class="list-row-title-line">
            <span class="list-row-title">{provider.name}</span>
            {provider.hasKey ? <Badge tone="ok">key set</Badge> : <Badge tone="warn">no key</Badge>}
            {testResult?.ok && <Badge tone="ok">{testResult.modelCount} models</Badge>}
            {testResult && !testResult.ok && <Badge tone="err">failed</Badge>}
          </div>
          <div class="list-row-sub">
            {provider.baseUrl} · key {provider.apiKeyMasked ?? "—"}
          </div>
          {testResult && !testResult.ok && testResult.error && (
            <div class="list-row-error">{testResult.error}</div>
          )}
        </div>

        <div class="list-row-actions">
          <Button variant="subtle" size="sm" onClick={toggleModels} loading={expanded?.loading}>
            {expanded?.models ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            Models
          </Button>
          <Button variant="subtle" size="sm" onClick={onTest} loading={testing}>
            <Zap size={15} />
            Test
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (editor.value = { kind: "edit", provider })}
            aria-label="Edit"
          >
            <Pencil size={15} />
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmDel(true)}
            aria-label="Delete"
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </div>

      {expanded && (
        <div class="list-row-expand">
          {expanded.loading ? (
            <div class="expand-loading">
              <Spinner size={14} /> Fetching models…
            </div>
          ) : expanded.error ? (
            <div class="list-row-error">{expanded.error}</div>
          ) : expanded.models && expanded.models.length > 0 ? (
            <div class="model-chips">
              {expanded.models.map((m) => (
                <span key={m} class="model-chip">
                  {m}
                </span>
              ))}
            </div>
          ) : (
            <div class="list-row-sub">No models returned.</div>
          )}
        </div>
      )}

      {confirmDel && (
        <Modal
          open
          size="md"
          title={`Delete "${provider.name}"?`}
          onClose={() => setConfirmDel(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDel(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  if (await deleteProvider(provider.id)) setConfirmDel(false);
                }}
              >
                <Trash2 size={15} />
                Delete
              </Button>
            </>
          }
        >
          <p>
            This removes the provider. Bots referencing it will need to be reassigned. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

function ProviderEditor() {
  const mode = editor.value;
  const isEdit = mode?.kind === "edit";
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyDirty, setKeyDirty] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; baseUrl?: string }>({});

  // Sync form fields whenever the editor opens / target changes.
  useEffect(() => {
    if (!mode) return;
    if (mode.kind === "edit") {
      setName(mode.provider.name);
      setBaseUrl(mode.provider.baseUrl);
      setApiKey("");
      setKeyDirty(false);
    } else {
      setName("");
      setBaseUrl("https://api.openai.com/v1");
      setApiKey("");
      setKeyDirty(false);
    }
    setErrors({});
  }, [mode]);

  if (!mode) return null;

  function close() {
    editor.value = null;
  }

  async function submit(e: Event) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Name is required";
    if (!baseUrl.trim()) errs.baseUrl = "Base URL is required";
    else if (!/^https?:\/\//.test(baseUrl.trim())) errs.baseUrl = "Must start with http(s)://";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      if (mode!.kind === "create") {
        const created = await createProvider({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey });
        if (created) close();
      } else {
        // Only send apiKey if the user typed a new one.
        const patch: { name: string; baseUrl: string; apiKey?: string } = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
        };
        if (keyDirty && apiKey) patch.apiKey = apiKey;
        const updated = await updateProvider(mode!.provider.id, patch);
        if (updated) close();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={isEdit ? `Edit "${mode.provider.name}"` : "New LLM provider"}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="provider-form" loading={saving} disabled={saving}>
            {isEdit ? "Save changes" : "Create provider"}
          </Button>
        </>
      }
    >
      <form id="provider-form" onSubmit={submit}>
        <Field
          label="Name"
          name="name"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="OpenAI"
          error={errors.name}
          autoFocus
        />
        <Field
          label="Base URL"
          name="baseUrl"
          value={baseUrl}
          onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
          placeholder="https://api.openai.com/v1"
          hint="OpenAI-compatible /v1 endpoint. Trailing slash is trimmed."
          error={errors.baseUrl}
        />
        <Field
          label={isEdit ? `API key${mode.provider.hasKey ? " (leave blank to keep current)" : ""}` : "API key"}
          name="apiKey"
          type="password"
          value={apiKey}
          onInput={(e) => {
            setApiKey((e.target as HTMLInputElement).value);
            setKeyDirty(true);
          }}
          placeholder={isEdit && mode.provider.hasKey ? mode.provider.apiKeyMasked ?? "••••" : "sk-…"}
          hint={
            isEdit && mode.provider.hasKey
              ? `Stored as ${mode.provider.apiKeyMasked}. Type a new key to replace it.`
              : "Stored encrypted at rest in SQLite. Never returned to the client in full."
          }
        />
      </form>
    </Modal>
  );
}
