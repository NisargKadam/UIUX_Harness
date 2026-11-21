import type { HarnessConfig } from "../config";

/** One problem in the prototype, from tsc, eslint or VS Code. */
export interface Diagnostic {
  /** Workspace-relative path, forward slashes. */
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  source: string;
  code?: string;
}

export interface AdapterContext {
  config: HarnessConfig;
  protoName: string;
  /** Workspace-relative prototype folder, e.g. "prototypes/settings". */
  protoRelDir: string;
}

export interface BaseFile {
  /** Workspace-relative path inside the prototype folder. */
  path: string;
  content: string;
  /** Overwrite on every scaffold (generated plumbing), or only create if missing. */
  overwrite: boolean;
}

/**
 * Framework-specific knowledge. The agent loop, tools and skills are framework
 * neutral; everything about file layout, entry points and routing for a given
 * stack lives behind this interface, so adding (say) Next.js or Vue means
 * adding one adapter.
 */
export interface FrameworkAdapter {
  readonly id: string;
  readonly displayName: string;
  /** Does this workspace look like this stack? */
  detect(workspaceRoot: string): boolean;
  /** Deterministic plumbing files written by the harness, not the model. */
  baseFiles(ctx: AdapterContext): BaseFile[];
  /** Framework notes injected into the system prompt. */
  promptNotes(ctx: AdapterContext): string;
  /** URL for a route on a running dev server. */
  routeUrl(baseUrl: string, route?: string): string;
  /** Parse type-checker output into diagnostics. */
  parseTypecheckOutput(output: string, workspaceRoot: string): Diagnostic[];
  /** Parse linter output into diagnostics. */
  parseLintOutput(output: string, workspaceRoot: string): Diagnostic[];
  /** Matches the dev server's "ready" line; group 1 is the URL. */
  readonly devServerReadyPattern: RegExp;
}
