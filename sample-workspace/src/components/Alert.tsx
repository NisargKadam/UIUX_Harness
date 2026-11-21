import type { ReactNode } from "react";
import { cx } from "./cx";

export interface AlertProps {
  tone?: "info" | "success" | "warning" | "danger";
  title: string;
  children?: ReactNode;
  /** When provided, shows a dismiss button. */
  onDismiss?: () => void;
}

/**
 * Inline message about the state of the page or a section: a save confirmation,
 * a validation summary, a warning. Not for transient toasts.
 * @category Feedback
 * @example
 * <Alert tone="success" title="Changes saved">Your profile is up to date.</Alert>
 */
export function Alert({ tone = "info", title, children, onDismiss }: AlertProps) {
  return (
    <div className={cx("ds-alert", `ds-alert--${tone}`)} role={tone === "danger" || tone === "warning" ? "alert" : "status"}>
      <div className="ds-alert__content">
        <strong className="ds-alert__title">{title}</strong>
        {children && <div className="ds-alert__body">{children}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="ds-alert__dismiss" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}
