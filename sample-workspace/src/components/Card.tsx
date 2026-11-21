import type { ReactNode } from "react";
import { cx } from "./cx";

export interface CardProps {
  /** Optional heading shown at the top of the card. */
  title?: string;
  /** Supporting line under the title. */
  description?: string;
  /** Controls shown at the top-right (e.g. a Button). */
  actions?: ReactNode;
  /** Content at the bottom, separated by a divider (e.g. Save / Cancel). */
  footer?: ReactNode;
  padding?: "sm" | "md" | "lg";
  className?: string;
  children?: ReactNode;
}

/**
 * Surface that groups related content, such as a form section or a summary.
 * Use a Card per logical group instead of drawing borders by hand.
 * @category Layout
 * @example
 * <Card title="Profile" description="How others see you" footer={<Button>Save</Button>}>
 *   <TextField label="Full name" value={name} onChange={setName} />
 * </Card>
 */
export function Card({ title, description, actions, footer, padding = "md", className, children }: CardProps) {
  return (
    <section className={cx("ds-card", `ds-card--pad-${padding}`, className)}>
      {(title || actions) && (
        <header className="ds-card__header">
          <div>
            {title && <h3 className="ds-card__title">{title}</h3>}
            {description && <p className="ds-card__description">{description}</p>}
          </div>
          {actions && <div className="ds-card__actions">{actions}</div>}
        </header>
      )}
      <div className="ds-card__body">{children}</div>
      {footer && <footer className="ds-card__footer">{footer}</footer>}
    </section>
  );
}
