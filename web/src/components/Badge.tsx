import type { ReactNode } from "preact/compat";

type Tone = "neutral" | "accent" | "ok" | "warn" | "err" | "info";

interface Props {
  tone?: Tone;
  children: ReactNode;
}

export function Badge({ tone = "neutral", children }: Props) {
  return <span class={`badge badge-${tone}`}>{children}</span>;
}
