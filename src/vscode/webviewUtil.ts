import { randomBytes } from "node:crypto";

export function nonce(): string {
  return randomBytes(16).toString("base64").replace(/[^A-Za-z0-9]/g, "");
}
