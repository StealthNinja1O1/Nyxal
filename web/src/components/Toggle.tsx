import type { ReactNode } from "preact/compat";

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  hint?: string;
  disabled?: boolean;
  // when true, the toggle is the whole clickable row
  bare?: boolean;
}

export function Toggle({ checked, onChange, label, hint, disabled, bare }: Props) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      class={`toggle ${checked ? "on" : ""} ${disabled ? "disabled" : ""}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span class="toggle-knob" />
    </button>
  );

  if (bare || !label) return control;
  return (
    <div class="toggle-row">
      <div class="toggle-text">
        <span class="toggle-label">{label}</span>
        {hint && <span class="toggle-hint">{hint}</span>}
      </div>
      {control}
    </div>
  );
}
