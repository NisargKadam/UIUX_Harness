import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual emphasis. Use one primary button per view. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  /** Stretch to the container width. */
  fullWidth?: boolean;
  /** Optional leading icon or glyph. */
  icon?: ReactNode;
  children?: ReactNode;
}

/**
 * Triggers an action. Primary for the main action, secondary for alternatives,
 * ghost for low-emphasis actions, danger for destructive ones.
 * @category Actions
 * @example
 * <Button variant="primary" onClick={save}>Save changes</Button>
 * <Button variant="ghost" size="sm">Cancel</Button>
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  icon,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx("ds-button", `ds-button--${variant}`, `ds-button--${size}`, fullWidth && "ds-button--full", className)}
    >
      {loading ? <span className="ds-button__spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
