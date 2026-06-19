import { useEffect, useRef, useState } from "preact/hooks";
import { RefreshCw, Check, AlertCircle, ChevronDown, Search } from "lucide-react";
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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [filter, setFilter] = useState("");
  // track which provider we last fetched so we can re-fetch on swap + skip
  // re-fetches when the value is stable.
  const lastFetchedFor = useRef<string | null>(null);

  const pid = resolveProviderId(props);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const fetching = state.kind === "loading";
  const inList =
    state.kind === "ready" && value ? state.models.includes(value) : false;

  const filteredModels =
    state.kind === "ready"
      ? filter.trim()
        ? state.models.filter((m) => m.toLowerCase().includes(filter.toLowerCase()))
        : state.models
      : [];

  function pickModel(m: string) {
    onChange(m);
    setDropdownOpen(false);
    setFilter("");
  }

  return (
    <div class="field" style={{ ...(bare ? { marginBottom: 0 } : {}), position: "relative" }} ref={containerRef}>
      {label && (
        <label class="field-label">
          {label}
        </label>
      )}
      <div class="field-row">
        <input
          class="field-input"
          value={value}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
          placeholder={placeholder ?? "gpt-4o"}
          autoComplete="off"
        />
        <div class="field-trailing">
          {state.kind === "ready" && state.models.length > 0 && (
            <button
              type="button"
              class="model-refresh-btn"
              title="Browse models"
              onClick={() => setDropdownOpen((v) => !v)}
            >
              <ChevronDown size={14} style={{ transform: dropdownOpen ? "rotate(180deg)" : "" }} />
            </button>
          )}
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
      {dropdownOpen && state.kind === "ready" && (
        <div class="model-dropdown">
          <div class="model-dropdown-search">
            <Search size={12} />
            <input
              type="text"
              class="model-dropdown-input"
              placeholder="Filter models..."
              value={filter}
              onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
              autoFocus
            />
            <span class="model-dropdown-count">{filteredModels.length}</span>
          </div>
          <div class="model-dropdown-list">
            {filteredModels.length === 0 ? (
              <p class="model-dropdown-empty">No models match "{filter}"</p>
            ) : (
              filteredModels.slice(0, 200).map((m) => (
                <button
                  key={m}
                  type="button"
                  class={`model-dropdown-item ${m === value ? "selected" : ""}`}
                  onClick={() => pickModel(m)}
                >
                  <span class="model-dropdown-item-name">{m}</span>
                  {m === value && <Check size={12} />}
                </button>
              ))
            )}
            {filteredModels.length > 200 && (
              <p class="model-dropdown-more">{filteredModels.length - 200} more - refine your filter</p>
            )}
          </div>
        </div>
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
              <>{state.models.length} models available - click the chevron to browse</>
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
