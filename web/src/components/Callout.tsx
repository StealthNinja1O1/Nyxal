import type { ReactNode } from "preact/compat";

type Tone = "info" | "warn" | "ok";

interface Props {
  tone?: Tone;
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
}

const TONE_CLASS: Record<Tone, string> = {
  info: "callout-info",
  warn: "callout-warn",
  ok: "callout-ok",
};

export function Callout({ tone = "info", icon, title, children }: Props) {
  return (
    <div class={`callout ${TONE_CLASS[tone]}`}>
      {icon && <span class="callout-icon">{icon}</span>}
      <div class="callout-body">
        {title && <div class="callout-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}
