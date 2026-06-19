import { useEffect, useRef, useState } from "preact/hooks";
import { RefreshCw, Check, AlertCircle } from "lucide-react";
import { providersApi } from "../api/providers";

interface Props {
  providerId: string | null | undefined;
  value: string;
  onChange: (model: string) => void;
  label?: string;
  placeholder?: string;
  hint?: string;
  bare?: boolean;
  fallbackProviderId?: string | null;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; models: string[] }
  | { kind: "error"; message: string };

function resolveProviderId(props: Props): string | null {
  if (props.providerId) return props.providerId;
  if (props.fallbackProviderId) return props.fallbackProviderId;
  return null;
}

export function ModelPicker(props: Props) {
  const { value, onChange, label, placeholder, hint, bare } = props;
  const [state, setState] = useState<State>({ kind: "idle" });
  // track which provider we last fetched so we can re-fetch on swap + skip
  // re-fetches when the value is stable.
  const lastFetchedFor = useRef<string | null>(null);
  // stable unique id for the datalist linkage
  const listId = useRef(`models-${Math.random().toString(36).slice(2, 9)}`).current;

  const pid = resolveProviderId(props);

  async function load(refresh = false) {
    if (!pid) {
      setState({ kind: "idle" });
      lastFetchedFor.current = null;
      return;
    }
    setState({ kind: "loading" });
    try {
      const res = await providersApi.models(pid);
      if ("error" in res && res.error) {
        setState({ kind: "error", message: res.error });
        return;
      }
      setState({ kind: "ready", models: res.models ?? [] });
      lastFetchedFor.current = pid;
      if (refresh && (res.models?.length ?? 0) > 0) {
        // nothing
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // auto-fetch whenever the resolved provider changes
  useEffect(() => {
    if (pid && pid !== lastFetchedFor.current && state.kind !== "loading") {
      void load(false);
    }
    if (!pid) {
      setState({ kind: "idle" });
      lastFetchedFor.current = null;
    }
  }, [pid]);

  const fetching = state.kind === "loading";
  const inList =
    state.kind === "ready" && value ? state.models.includes(value) : false;

  return (
    <div class="field" style={bare ? { marginBottom: 0 } : undefined}>
      {label && (
        <label class="field-label" for={listId}>
          {label}
        </label>
      )}
      <div class="field-row">
        <input
          id={listId}
          class="field-input"
          list={pid ? listId : undefined}
          value={value}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
          placeholder={placeholder ?? "gpt-4o"}
          autoComplete="off"
        />
        <div class="field-trailing">
          <button
            type="button"
            class="model-refresh-btn"
            title={pid ? "Refresh model list" : "Pick a provider first"}
            disabled={!pid || fetching}
            onClick={() => void load(true)}
          >
            <RefreshCw size={14} class={fetching ? "spin" : ""} />
          </button>
        </div>
      </div>
      {pid && state.kind === "ready" && (
        <datalist id={listId}>
          {state.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}
      <div class="model-meta">
        {state.kind === "loading" && (
          <span class="model-meta-loading">fetching models…</span>
        )}
        {state.kind === "ready" && (
          <span class="model-meta-ready">
            {inList ? (
              <>
                <Check size={11} /> known model
              </>
            ) : value ? (
              <>
                <AlertCircle size={11} /> not in provider list
              </>
            ) : (
              <>{state.models.length} models available</>
            )}
          </span>
        )}
        {state.kind === "error" && (
          <span class="model-meta-error" title={state.message}>
            <AlertCircle size={11} /> {state.message}
          </span>
        )}
        {!pid && <span class="model-meta-hint">select a provider to fetch models</span>}
      </div>
      {hint && <p class="field-hint" style={{ marginTop: 4 }}>{hint}</p>}
    </div>
  );
}
