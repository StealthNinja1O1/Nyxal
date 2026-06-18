import type { ButtonHTMLAttributes, ReactNode } from "preact/compat";

type Variant = "primary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: Props) {
  const cls = ["btn", `btn-${variant}`, `btn-${size}`, loading && "btn-loading", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button {...rest} className={cls} disabled={disabled || loading}>
      {loading && <span class="btn-spinner" aria-hidden />}
      {children}
    </button>
  );
}
