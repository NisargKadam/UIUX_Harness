/** Remove ANSI colour codes from tool output. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}
