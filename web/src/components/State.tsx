import type { ReactNode } from "preact/compat";

export function Spinner({ size = 16 }: { size?: number }) {
  return <span class="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div class="state state-loading">
      <Spinner size={20} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div class="state state-empty">
      {icon && <div class="state-icon">{icon}</div>}
      <h3>{title}</h3>
      {subtitle && <p>{subtitle}</p>}
      {action && <div class="state-action">{action}</div>}
    </div>
  );
}
