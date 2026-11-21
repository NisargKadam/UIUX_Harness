import type { ElementType, ReactNode } from "react";
import { cx } from "./cx";

export interface TextProps {
  /** Typographic role. Picks size, weight and default element. */
  variant?: "display" | "title" | "heading" | "body" | "label" | "caption";
  /** Colour intent. */
  tone?: "default" | "muted" | "primary" | "danger" | "success";
  /** Override the element, e.g. "h1" for a page title, "span" inline. */
  as?: ElementType;
  /** Truncate to one line with an ellipsis. */
  truncate?: boolean;
  className?: string;
  children?: ReactNode;
}

const defaultElement: Record<NonNullable<TextProps["variant"]>, ElementType> = {
  display: "h1",
  title: "h2",
  heading: "h3",
  body: "p",
  label: "span",
  caption: "span",
};

/**
 * Typography primitive. Every piece of text in a prototype should be a Text (or a
 * component that renders its own text) so type styles come from tokens.
 * @category Typography
 * @example
 * <Text variant="title" as="h1">Settings</Text>
 * <Text tone="muted">Manage your account and preferences.</Text>
 */
export function Text({ variant = "body", tone = "default", as, truncate = false, className, children }: TextProps) {
  const Component = as ?? defaultElement[variant];
  return (
    <Component className={cx("ds-text", `ds-text--${variant}`, `ds-text--tone-${tone}`, truncate && "ds-text--truncate", className)}>
      {children}
    </Component>
  );
}
