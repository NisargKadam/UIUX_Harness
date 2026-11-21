import { cx } from "./cx";

export interface AvatarProps {
  /** Person's name. Used for initials and the accessible label. */
  name: string;
  /** Image URL. Falls back to initials when missing. */
  src?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Picture or initials representing a person.
 * @category Data display
 * @example
 * <Avatar name="Ada Lovelace" size="lg" />
 */
export function Avatar({ name, src, size = "md" }: AvatarProps) {
  return (
    <span className={cx("ds-avatar", `ds-avatar--${size}`)} role="img" aria-label={name}>
      {src ? <img src={src} alt="" className="ds-avatar__img" /> : initials(name)}
    </span>
  );
}
