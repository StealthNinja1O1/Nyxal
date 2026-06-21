import type { ReactNode } from "preact/compat";
import { useEffect } from "preact/hooks";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** "md" | "lg" — lg for forms with many fields. */
  size?: "md" | "lg";
  /** When false, clicking the overlay or pressing Escape will NOT close the modal. */
  closeOnOutsideClick?: boolean;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = "md",
  closeOnOutsideClick = true,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnOutsideClick) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, closeOnOutsideClick]);

  if (!open) return null;

  return (
    <div
      class="modal-overlay"
      onClick={() => {
        if (closeOnOutsideClick) onClose();
      }}
    >
      <div class={`modal modal-${size}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header class="modal-header">
          <h2 class="modal-title">{title}</h2>
          <button class="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div class="modal-body">{children}</div>
        {footer && <footer class="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
