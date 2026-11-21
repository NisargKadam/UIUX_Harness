/**
 * Type check and lint, shared by the run_command tool and the loop's
 * code-enforced quality gate. Problems are split into "in the prototype" (the
 * agent must fix them) and "elsewhere" (e.g. pre-existing library errors the
 * agent is not allowed to touch, which are reported but never block).
 */
import type { Diagnostic, FrameworkAdapter } from "../adapters/types";
import type { HarnessConfig } from "../config";
import { resolveCommand, type CommandName } from "../policy/commandPolicy";
import { runToCompletion } from "../process/runner";

export interface CheckResult {
  command: CommandName;
  ran: boolean;
  /** Why it did not run (not configured / tool missing). */
  skippedReason?: string;
  passed: boolean;
  inPrototype: Diagnostic[];
  elsewhere: Diagnostic[];
  rawTail: string;
  exitCode: number | null;
}

const LINT_NOT_CONFIGURED = /(couldn't find (an )?(eslint\.config|a configuration file)|No ESLint configuration found|could not find config file)/i;
// Matched only when no diagnostics were parsed (an "ENOENT" inside a lint message must not count).
const TOOL_MISSING = /(command not found|is not recognized as an internal or external command|could not determine executable to run|npx canceled due to missing packages|^Error: spawn \S+ ENOENT)/im;

export async function runCheck(
  command: "typecheck" | "lint",
  config: HarnessConfig,
  adapter: FrameworkAdapter,
  protoRelDir: string,
  signal?: AbortSignal,
): Promise<CheckResult> {
  const template = command === "typecheck" ? config.commands.typecheck : config.commands.lint;
  const base: Omit<CheckResult, "passed" | "ran"> = { command, inPrototype: [], elsewhere: [], rawTail: "", exitCode: null };
  if (!template.trim()) {
    return { ...base, ran: false, passed: true, skippedReason: `No ${command} command configured.` };
  }
  const cmd = resolveCommand(command, config.commands, { protoDir: protoRelDir });
  const result = await runToCompletion(cmd, config.workspaceRoot, { timeoutMs: 180_000, signal });
  const output = result.output;
  const rawTail = output.split(/\r?\n/).slice(-60).join("\n");
  const diagnostics = command === "typecheck" ? adapter.parseTypecheckOutput(output, config.workspaceRoot) : adapter.parseLintOutput(output, config.workspaceRoot);
  if (command === "lint" && result.exitCode !== 0 && diagnostics.length === 0 && LINT_NOT_CONFIGURED.test(output)) {
    return { ...base, ran: false, passed: true, skippedReason: "Linting isn't set up in this workspace.", rawTail, exitCode: result.exitCode };
  }
  if (result.exitCode !== 0 && diagnostics.length === 0 && TOOL_MISSING.test(output)) {
    return { ...base, ran: false, passed: true, skippedReason: `The ${command} tool isn't installed in this project.`, rawTail, exitCode: result.exitCode };
  }
  const prefix = `${protoRelDir}/`;
  const inPrototype = diagnostics.filter((d) => d.file.startsWith(prefix));
  const elsewhere = diagnostics.filter((d) => !d.file.startsWith(prefix));
  const blocking = inPrototype.filter((d) => d.severity === "error");
  // A non-zero exit with no parsed diagnostics is still a failure (config error, crash, timeout).
  const unexplainedFailure = result.exitCode !== 0 && diagnostics.length === 0;
  return {
    command,
    ran: true,
    passed: blocking.length === 0 && !unexplainedFailure && !result.timedOut,
    inPrototype,
    elsewhere,
    rawTail: result.timedOut ? `${rawTail}\n(timed out)` : rawTail,
    exitCode: result.exitCode,
  };
}

export function formatDiagnostics(list: Diagnostic[], max = 40): string {
  const lines = list.slice(0, max).map((d) => `${d.file}:${d.line}:${d.column} ${d.severity} ${d.code ? `${d.code} ` : ""}${d.message}`);
  if (list.length > max) lines.push(`… and ${list.length - max} more`);
  return lines.join("\n");
}

export function formatCheck(r: CheckResult): string {
  const name = r.command === "typecheck" ? "Type check" : "Lint";
  if (!r.ran) return `${name}: skipped (${r.skippedReason ?? "not available"}).`;
  const parts: string[] = [];
  if (r.passed) {
    const warnings = r.inPrototype.filter((d) => d.severity !== "error");
    parts.push(`${name}: passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.`);
    if (warnings.length) parts.push(formatDiagnostics(warnings, 15));
  } else if (r.inPrototype.length > 0) {
    parts.push(`${name}: ${r.inPrototype.filter((d) => d.severity === "error").length} error(s) in the prototype:`);
    parts.push(formatDiagnostics(r.inPrototype));
  } else {
    parts.push(`${name}: failed (exit ${r.exitCode}) without file-level errors. Output:\n${r.rawTail}`);
  }
  if (r.elsewhere.length > 0) {
    parts.push(
      `(${r.elsewhere.length} problem(s) outside the prototype, e.g. in the component library, were ignored: you cannot change those files. First: ${formatDiagnostics(r.elsewhere, 3)})`,
    );
  }
  return parts.join("\n");
}
