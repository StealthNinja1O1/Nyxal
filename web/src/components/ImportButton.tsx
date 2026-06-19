import { useRef, useState } from "preact/hooks";
import { Upload, ChevronDown } from "lucide-react";
import { Button } from "./Button";
import { tryParseJson } from "../lib/importers";

interface Props {
  label: string;
  onFile: (text: string, filename: string) => Promise<void> | void;
  accept?: string;
  variant?: "subtle" | "primary" | "ghost";
}

export function ImportButton({ label, onFile, accept = ".json,application/json", variant = "subtle" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const check = tryParseJson(text);
      if (!check.ok) throw new Error(`Not valid JSON: ${check.error}`);
      await onFile(text, file.name);
    } catch (err) {
      // surfaced via toast in the caller's try/catch
      throw err;
    } finally {
      setBusy(false);
      // reset so picking the same file twice still fires onChange
      input.value = "";
    }
  }

  return (
    <>
      <Button variant={variant} size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
        <Upload size={14} />
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          void onChange(e).catch(() => {
            // caller handles toast
          });
        }}
      />
    </>
  );
}

/** small dropdown for "import" + "merge vs replace" choice. used on lorebook tabs. */
export function ImportDropdown({
  label,
  onImport,
}: {
  label: string;
  onImport: (mode: "merge" | "replace", text: string, filename: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const fileRefMerge = useRef<HTMLInputElement>(null);
  const fileRefReplace = useRef<HTMLInputElement>(null);

  async function readAndRun(mode: "merge" | "replace", e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setOpen(false);
    try {
      const text = await file.text();
      await onImport(mode, text, file.name);
    } finally {
      input.value = "";
    }
  }

  return (
    <div class="import-dropdown">
      <Button variant="subtle" size="sm" onClick={() => setOpen((o) => !o)}>
        <Upload size={14} />
        {label}
        <ChevronDown size={12} />
      </Button>
      {open && (
        <>
          <div class="import-dropdown-scrim" onClick={() => setOpen(false)} />
          <div class="import-dropdown-menu">
            <button class="import-dropdown-item" onClick={() => fileRefMerge.current?.click()}>
              Merge (keep existing, add new)
            </button>
            <button class="import-dropdown-item danger" onClick={() => fileRefReplace.current?.click()}>
              Replace (wipe book, import all)
            </button>
          </div>
        </>
      )}
      <input ref={fileRefMerge} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => void readAndRun("merge", e)} />
      <input ref={fileRefReplace} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => void readAndRun("replace", e)} />
    </div>
  );
}
