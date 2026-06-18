import { useEffect } from "preact/hooks";
import { toasts, dismiss } from "../state/toast";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";
import type { ToastKind } from "../state/toast";

const ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warn: AlertTriangle,
};

export function ToastHost() {
  useEffect(() => {
    // subscribe; effect in toast.ts keeps the signal reactive
  }, []);

  return (
    <div class="toast-host">
      {toasts.value.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div key={t.id} class={`toast toast-${t.kind}`} role="status">
            <Icon size={16} />
            <span class="toast-msg">{t.message}</span>
            <button class="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
