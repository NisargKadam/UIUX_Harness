/** Join class names, skipping falsy values. Internal helper, not exported from the library. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
