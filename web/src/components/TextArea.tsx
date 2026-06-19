import type { TextareaHTMLAttributes } from "preact/compat";

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "label"> {
  label: string;
  hint?: string;
  error?: string;
  // monospace styling for code-like stuff
  mono?: boolean;
}

export function TextArea({ label, hint, error, mono, id, className, ...rest }: Props) {
  const inputId = id || rest.name;
  return (
    <div class={`field ${className ?? ""}`}>
      <label class="field-label" for={inputId}>
        {label}
      </label>
      <textarea
        id={inputId}
        class={`field-input field-textarea ${mono ? "mono" : ""} ${error ? "has-error" : ""}`}
        {...rest}
      />
      {error ? <p class="field-error">{error}</p> : hint ? <p class="field-hint">{hint}</p> : null}
    </div>
  );
}
