/**
 * The six built-in tools: read_file, write_file, run_command, get_diagnostics,
 * preview and ask_user. Each one has a zod schema. With eager input streaming
 * the API no longer validates tool input, so we validate it before anything runs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import type { Diagnostic, FrameworkAdapter } from "../adapters/types";
import type { HarnessConfig } from "../config";
import type { HarnessHost } from "../host";
import { COMMAND_NAMES, resolveCommand } from "../policy/commandPolicy";
import { resolveReadPath, resolveWritePath, slugifyPrototypeName, toWorkspaceRelative } from "../policy/pathGuard";
import type { DevServerManager } from "../process/runner";
import { findFreePort } from "../process/runner";
import type { PrototypePlan } from "../protocol";
import { renderMissingComponentsDoc, type SessionState } from "../agent/state";
import { formatCheck, formatDiagnostics, runCheck } from "./checks";

export type ToolResultContent = Exclude<Anthropic.Beta.BetaToolResultBlockParam["content"], string | undefined>;

export interface ToolOutput {
  content: string | ToolResultContent;
  isError?: boolean;
}

export interface ToolContext {
  config: HarnessConfig;
  adapter: FrameworkAdapter;
  host: HarnessHost;
  devServer: DevServerManager;
  state: SessionState;
  signal: AbortSignal;
}

export interface BuiltinTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutput>;
}

const activity = z
  .string()
  .max(80)
  .optional()
  .describe('Short plain-language label for the designer, e.g. "Building the Profile screen". No file names or jargon.');

const MAX_READ_CHARS = 120_000;

// ------------------------------------------------------------------ read_file

const readFileSchema = z.object({
  path: z.string().describe('Workspace-relative path, e.g. "src/components/Button.tsx". A folder path lists its contents.'),
  offset: z.number().int().min(1).optional().describe("First line to return (1-based)."),
  limit: z.number().int().min(1).max(5000).optional().describe("Number of lines to return."),
  activity,
});

const readFile: BuiltinTool<typeof readFileSchema> = {
  name: "read_file",
  description:
    "Read a text file or list a folder anywhere in the workspace (component sources, tokens, existing prototype files). Secrets, .git and node_modules are not readable.",
  schema: readFileSchema,
  async run(input, ctx) {
    const abs = resolveReadPath(ctx.config.workspaceRoot, input.path);
    if (!fs.existsSync(abs)) return { content: `Not found: ${input.path}`, isError: true };
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      const entries = fs
        .readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.name !== "node_modules" && e.name !== ".git" && !/^\.env/.test(e.name))
        .slice(0, 300)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return { content: entries.length ? entries.join("\n") : "(empty folder)" };
    }
    if (stat.size > 2_000_000) return { content: `File is too large to read (${stat.size} bytes).`, isError: true };
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) return { content: "Binary file; not shown.", isError: true };
    let text = buf.toString("utf8");
    if (input.offset || input.limit) {
      const lines = text.split("\n");
      const start = (input.offset ?? 1) - 1;
      text = lines.slice(start, start + (input.limit ?? lines.length)).join("\n");
    }
    if (text.length > MAX_READ_CHARS) text = `${text.slice(0, MAX_READ_CHARS)}\n…[truncated; use offset/limit]`;
    return { content: text };
  },
};

// ------------------------------------------------------------------ write_file

const writeFileSchema = z
  .object({
    path: z.string().describe('Workspace-relative path inside the active prototype, e.g. "prototypes/settings/screens/ProfileScreen.tsx".'),
    content: z.string().optional().describe("Full new file content. Use for new files or rewrites."),
    edits: z
      .array(z.object({ find: z.string().min(1), replace: z.string() }))
      .optional()
      .describe("Targeted edits to an existing file. Each `find` must match exactly once."),
    activity,
  })
  .refine((v) => (v.content === undefined) !== (v.edits === undefined), { message: "Provide exactly one of `content` or `edits`." });

const writeFile: BuiltinTool<typeof writeFileSchema> = {
  name: "write_file",
  description:
    "Create or change a file in the active prototype folder. This is the only way to write, and it is hard-limited to prototypes/<name>/. Build/package config files are managed by the harness and cannot be written. Prefer `edits` for small changes to existing files.",
  schema: writeFileSchema,
  async run(input, ctx) {
    const scope = ctx.state.writeScope();
    const abs = resolveWritePath(scope, input.path);
    const rel = toWorkspaceRelative(ctx.config.workspaceRoot, abs);
    const existed = fs.existsSync(abs);
    const before = existed ? fs.readFileSync(abs, "utf8") : "";
    let after: string;
    if (input.edits) {
      if (!existed) return { content: `Cannot edit ${rel}: it does not exist. Use content to create it.`, isError: true };
      after = before;
      for (const [i, edit] of input.edits.entries()) {
        const count = after.split(edit.find).length - 1;
        if (count !== 1) {
          return {
            content: `Edit ${i + 1} of ${input.edits.length} not applied to ${rel}: \`find\` matched ${count} times (must be exactly once). No changes were written. Re-read the file and retry.`,
            isError: true,
          };
        }
        after = after.replace(edit.find, () => edit.replace);
      }
    } else {
      after = input.content ?? "";
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, after);
    ctx.state.writeSeq++;
    ctx.state.filesWritten.add(rel);
    const diff = createTwoFilesPatch(rel, rel, before, after, existed ? "before" : "(new file)", "after", { context: 3 });
    ctx.host.emit({ type: "file_written", path: rel, created: !existed, diff });
    const lines = after.split("\n").length;
    return { content: `${existed ? "Updated" : "Created"} ${rel} (${lines} lines).` };
  },
};

// ------------------------------------------------------------------ run_command

const runCommandSchema = z.object({
  command: z.enum(COMMAND_NAMES).describe("dev_server: start/reuse the live preview server. typecheck: TypeScript check. lint: ESLint."),
  activity,
});

const runCommand: BuiltinTool<typeof runCommandSchema> = {
  name: "run_command",
  description:
    "Run one of the allowlisted project commands for the active prototype. You choose the command by name only; the actual command line comes from the designer's settings.",
  schema: runCommandSchema,
  async run(input, ctx) {
    const protoRelDir = ctx.state.protoRelDir;
    if (!protoRelDir) return { content: "No prototype is active yet.", isError: true };
    if (input.command === "dev_server") {
      const running = ctx.devServer.current;
      if (running && running.prototype === ctx.state.prototype) {
        return { content: `Dev server already running at ${running.url} (hot reload is on: saved files appear automatically).` };
      }
      const port = await findFreePort(5180);
      const cmd = resolveCommand("dev_server", ctx.config.commands, { protoDir: protoRelDir, port });
      const info = await ctx.devServer.start(cmd, ctx.config.workspaceRoot, ctx.state.prototype!, port, ctx.adapter.devServerReadyPattern);
      ctx.host.emit({ type: "preview", url: info.url });
      return { content: `Dev server running at ${info.url}. Open it in the designer's preview with the preview tool.` };
    }
    const result = await runCheck(input.command, ctx.config, ctx.adapter, protoRelDir, ctx.signal);
    if (input.command === "typecheck" && result.passed && result.ran) ctx.state.lastCleanCheckSeq = ctx.state.writeSeq;
    const serverTail = ctx.devServer.current ? ctx.devServer.recentOutput(15) : "";
    const serverErrors = /error|failed to resolve|does not provide an export/i.test(serverTail)
      ? `\nRecent dev server output:\n${serverTail}`
      : "";
    return { content: formatCheck(result) + serverErrors, isError: !result.passed };
  },
};

// ------------------------------------------------------------------ get_diagnostics

const diagnosticsSchema = z.object({ activity });

const getDiagnostics: BuiltinTool<typeof diagnosticsSchema> = {
  name: "get_diagnostics",
  description:
    "All known problems in the active prototype: what VS Code's extensions report (ESLint, CSS, TypeScript for open files) merged with a full type-checker run, so nothing is missed. Use after edits, before reviewing.",
  schema: diagnosticsSchema,
  async run(_input, ctx) {
    const protoRelDir = ctx.state.protoRelDir;
    if (!protoRelDir) return { content: "No prototype is active yet.", isError: true };
    const [fromEditor, typecheck] = await Promise.all([
      ctx.host.getDiagnostics(protoRelDir, ctx.signal),
      runCheck("typecheck", ctx.config, ctx.adapter, protoRelDir, ctx.signal),
    ]);
    const merged = mergeDiagnostics(fromEditor ?? [], typecheck.inPrototype);
    if (typecheck.passed && typecheck.ran) ctx.state.lastCleanCheckSeq = ctx.state.writeSeq;
    const sources = `${fromEditor === undefined ? "editor diagnostics unavailable here" : `${fromEditor.length} from the editor`}, ${typecheck.ran ? `${typecheck.inPrototype.length} from the type checker` : "type checker skipped"}`;
    if (merged.length === 0) {
      const failedWithoutDetail = typecheck.ran && !typecheck.passed;
      return { content: failedWithoutDetail ? formatCheck(typecheck) : `No problems in the prototype (${sources}).`, isError: failedWithoutDetail };
    }
    const errors = merged.filter((d) => d.severity === "error").length;
    return { content: `${errors} error(s), ${merged.length - errors} warning(s) (${sources}):\n${formatDiagnostics(merged, 60)}`, isError: errors > 0 };
  },
};

/** Merge editor and type-checker diagnostics, dropping duplicates of the same problem. */
export function mergeDiagnostics(a: Diagnostic[], b: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const d of [...a, ...b]) {
    const key = `${d.file}:${d.line}:${d.column}:${d.message.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out.sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line);
}

// ------------------------------------------------------------------ preview

const previewSchema = z.object({
  action: z.enum(["open", "reload", "navigate"]),
  route: z.string().optional().describe('Hash route for open/navigate, e.g. "/settings/notifications".'),
  activity,
});

const preview: BuiltinTool<typeof previewSchema> = {
  name: "preview",
  description: "Control the designer's live preview panel inside VS Code: open it, reload it, or show a specific screen (route).",
  schema: previewSchema,
  async run(input, ctx) {
    const server = ctx.devServer.current;
    if (!server) return { content: "The dev server is not running. Start it with run_command dev_server first.", isError: true };
    const url = ctx.adapter.routeUrl(server.url, input.route);
    if (input.action === "reload") await ctx.host.preview.reload();
    else if (input.action === "navigate") await ctx.host.preview.navigate(url);
    else await ctx.host.preview.open(url);
    ctx.host.emit({ type: "preview", url, route: input.route });
    return { content: `Preview ${input.action === "reload" ? "reloaded" : `showing ${url}`}.` };
  },
};

// ------------------------------------------------------------------ ask_user

const planSchema = z.object({
  prototypeName: z.string().describe('Short kebab-case folder name, e.g. "account-settings".'),
  title: z.string(),
  summary: z.string().describe("One or two sentences in plain language."),
  screens: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        route: z.string().describe('Hash route, e.g. "/settings/profile".'),
        purpose: z.string(),
        components: z.array(z.string()).describe("Catalogue components this screen uses."),
      }),
    )
    .min(1),
  flow: z.array(z.object({ from: z.string(), action: z.string(), to: z.string() })),
  missingComponents: z
    .array(
      z.object({
        need: z.string(),
        usingInstead: z.string(),
        reason: z.string(),
        screens: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  assumptions: z.array(z.string()).default([]),
});

const askUserSchema = z.object({
  question: z.string().describe("Plain language, no jargon. For a plan: \"Shall I build this?\""),
  options: z.array(z.string()).max(4).optional().describe("Up to 4 short answer choices."),
  plan: planSchema.optional().describe("Include to show the screen list and click flow for approval before any code is written."),
  activity,
});

const askUser: BuiltinTool<typeof askUserSchema> = {
  name: "ask_user",
  description:
    "Ask the designer something and wait for the answer. Use it (1) to present the plan for approval before writing any files (include `plan`), and (2) at most once per request for a clarifying question when the brief is ambiguous in a way that changes what you build.",
  schema: askUserSchema,
  async run(input, ctx) {
    let plan: PrototypePlan | undefined;
    if (input.plan) {
      const name = ctx.state.uniqueName(slugifyPrototypeName(input.plan.prototypeName));
      plan = { ...input.plan, prototypeName: name };
    } else {
      if (ctx.state.questionsAsked >= 1) {
        return {
          content:
            "You have already asked the designer a question in this request. Make a sensible assumption instead, state it in the plan's assumptions (or in your summary), and continue.",
          isError: true,
        };
      }
      ctx.state.questionsAsked++;
    }
    const id = randomUUID();
    const options = plan ? ["Build it", "Change something"] : input.options ?? [];
    ctx.host.emit({ type: "question", id, question: input.question, options, plan });
    const response = await ctx.host.askUser({ id, question: input.question, options, plan }, ctx.signal);

    if (!plan) return { content: `The designer answered: ${response.answer}` };
    if (!response.approved) {
      return {
        content: `The designer has not approved the plan yet. Their feedback: "${response.answer}". Revise the plan and present it again with ask_user.`,
      };
    }
    const written = ctx.state.activate(plan.prototypeName);
    const brief = ctx.state.record?.brief ?? ctx.state.pendingBrief;
    const now = new Date().toISOString();
    ctx.state.record = {
      name: plan.prototypeName,
      brief,
      figmaUrl: ctx.state.record?.figmaUrl ?? ctx.state.pendingFigmaUrl,
      plan,
      missingComponents: plan.missingComponents,
      feedback: ctx.state.record?.feedback ?? [],
      createdAt: ctx.state.record?.createdAt ?? now,
      updatedAt: now,
    };
    ctx.state.saveRecord();
    const missingDoc = resolveWritePath(ctx.state.writeScope(), `${ctx.state.protoRelDir}/MISSING_COMPONENTS.md`);
    fs.writeFileSync(missingDoc, renderMissingComponentsDoc(plan));
    ctx.host.emit({ type: "plan_approved", plan });
    ctx.host.emit({ type: "missing_components", items: plan.missingComponents });
    const note = response.answer && !/^build it$/i.test(response.answer.trim()) ? ` They added: "${response.answer}".` : "";
    return {
      content: `The designer approved the plan.${note} The active prototype is ${ctx.state.protoRelDir}/. The harness wrote the plumbing (${written.join(", ")}) and MISSING_COMPONENTS.md. Now build the screens, mock data and App.tsx, then start the dev server and open the preview.`,
    };
  },
};

// ------------------------------------------------------------------ registry

export const BUILTIN_TOOLS: BuiltinTool[] = [readFile, writeFile, runCommand, getDiagnostics, preview, askUser] as unknown as BuiltinTool[];

export function builtinToolDefinitions(): Anthropic.Beta.BetaTool[] {
  return BUILTIN_TOOLS.map((tool) => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    return {
      name: tool.name,
      description: tool.description,
      input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
      eager_input_streaming: true,
    };
  });
}

export function findBuiltin(name: string): BuiltinTool | undefined {
  return BUILTIN_TOOLS.find((t) => t.name === name);
}
