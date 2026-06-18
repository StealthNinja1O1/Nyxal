import type { InputHTMLAttributes, ReactNode } from "preact/compat";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "label"> {
  label: string;
  hint?: string;
  error?: string;
  /** Right-aligned adornment (e.g. a "test" button or status icon). */
  trailing?: ReactNode;
}

export function Field({ label, hint, error, trailing, id, className, ...rest }: Props) {
  const inputId = id || rest.name;
  return (
    <div class={`field ${className ?? ""}`}>
      <label class="field-label" for={inputId}>
        {label}
      </label>
      <div class="field-row">
        <input id={inputId} class={`field-input ${error ? "has-error" : ""}`} {...rest} />
        {trailing && <div class="field-trailing">{trailing}</div>}
      </div>
      {error ? <p class="field-error">{error}</p> : hint ? <p class="field-hint">{hint}</p> : null}
    </div>
  );
}
