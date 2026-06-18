// no spiders here
import { signal, effect } from "@preact/signals";

export type ToastKind = "success" | "error" | "info" | "warn";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const toasts = signal<Toast[]>([]);
let nextId = 1;

function push(message: string, kind: ToastKind, ttl = 4000): void {
  const id = nextId++;
  toasts.value = [...toasts.value, { id, kind, message }];
  if (ttl > 0) 
    setTimeout(() => dismiss(id), ttl);
}

export function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

/** Imperative toast API used by state modules and components. */
export const toast = {
  show: (message: string, kind: ToastKind = "info") => push(message, kind),
  success: (message: string) => push(message, "success"),
  error: (message: string) => push(message, "error", 8000),
  info: (message: string) => push(message, "info"),
  warn: (message: string) => push(message, "warn", 6000),
};

effect(() => void toasts.value);

export { toasts };
