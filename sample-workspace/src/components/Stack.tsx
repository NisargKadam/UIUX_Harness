import type { CSSProperties, ElementType, ReactNode } from "react";
import { cx } from "./cx";

export type SpaceStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface StackProps {
  /** Lay children out in a column (default) or a row. */
  direction?: "column" | "row";
  /** Gap between children, as a step on the spacing scale (--space-N). */
  gap?: SpaceStep;
  /** Cross-axis alignment. */
  align?: "start" | "center" | "end" | "stretch";
  /** Main-axis distribution. */
  justify?: "start" | "center" | "end" | "between";
  /** Allow children to wrap onto new lines (rows only). */
  wrap?: boolean;
  /** Inner padding, as a step on the spacing scale. */
  padding?: SpaceStep;
  /** Render as a different element, e.g. "section", "form", "ul". */
  as?: ElementType;
  className?: string;
  children?: ReactNode;
}

/**
 * Layout primitive: arranges children in a row or column with token-based spacing.
 * Use it for every layout instead of hand-written flexbox or margins.
 * @category Layout
 * @example
 * <Stack direction="row" gap={3} align="center">
 *   <Avatar name="Ada Lovelace" />
 *   <Text variant="heading">Ada Lovelace</Text>
 * </Stack>
 */
export function Stack({
  direction = "column",
  gap = 4,
  align = "stretch",
  justify = "start",
  wrap = false,
  padding = 0,
  as: Component = "div",
  className,
  children,
}: StackProps) {
  const style: CSSProperties = {
    gap: `var(--space-${gap})`,
    padding: `var(--space-${padding})`,
  };
  return (
    <Component
      className={cx("ds-stack", `ds-stack--${direction}`, `ds-stack--align-${align}`, `ds-stack--justify-${justify}`, wrap && "ds-stack--wrap", className)}
      style={style}
    >
      {children}
    </Component>
  );
}
