/**
 * Command allowlist. The model never sends a command string. The run_command
 * tool takes a command *name* ("dev_server" | "typecheck" | "lint"), and this
 * module maps that name to the configured template.
 *
 * Templates come from settings, and workspace settings can be committed to a
 * repository someone else controls. Templates are therefore validated too:
 *  - no shell metacharacters. Commands are spawned without a shell, and on
 *    Windows (where .cmd shims need one) the check is what makes that safe
 *  - the executable must be on a short allowlist
 *  - npx / npm exec / pnpm dlx may run only allowlisted tools
 *  - node may not evaluate inline code (-e / -p / --eval / --print)
 * The extension also declares itself unsupported in untrusted workspaces.
 */

export const COMMAND_NAMES = ["dev_server", "typecheck", "lint"] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

export class CommandPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandPolicyError";
  }
}

/** Executables a template may start with. */
export const ALLOWED_EXECUTABLES = new Set(["npx", "npm", "pnpm", "yarn", "bun", "bunx", "node", "vite", "tsc", "eslint"]);

/** Tools npx / `npm exec` / `pnpm dlx` / bunx may launch. */
export const ALLOWED_PACKAGE_TOOLS = new Set(["vite", "tsc", "typescript", "eslint", "@biomejs/biome", "biome"]);

/** Package-manager subcommands that are allowed (scripts come from the workspace's package.json). */
const ALLOWED_PM_SUBCOMMANDS = new Set(["run", "exec", "dlx", "x"]);

const SHELL_METACHARACTERS = /[;&|`$<>(){}\n\r*?!#~]|\\/;

export interface CommandTemplates {
  devServer: string;
  typecheck: string;
  lint: string;
}

export interface CommandVars {
  /** Workspace-relative prototype folder, forward slashes. */
  protoDir: string;
  /** Port for the dev server. */
  port?: number;
}

export interface ResolvedCommand {
  name: CommandName;
  executable: string;
  args: string[];
  /** Human-readable form, for logs. */
  display: string;
}

/** Whitespace tokenizer with simple single/double quote support. Throws on unbalanced quotes. */
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (quote) throw new CommandPolicyError("Unbalanced quote in command.");
  if (hasToken) tokens.push(current);
  return tokens;
}

function templateFor(name: CommandName, templates: CommandTemplates): string {
  switch (name) {
    case "dev_server":
      return templates.devServer;
    case "typecheck":
      return templates.typecheck;
    case "lint":
      return templates.lint;
  }
}

const SAFE_PROTO_DIR = /^[A-Za-z0-9._/-]+$/;

function substitute(template: string, vars: CommandVars): string {
  if (!SAFE_PROTO_DIR.test(vars.protoDir) || vars.protoDir.split("/").includes("..")) {
    throw new CommandPolicyError(`Unsafe prototype path "${vars.protoDir}".`);
  }
  let out = template.replaceAll("{protoDir}", vars.protoDir);
  if (out.includes("{port}")) {
    if (vars.port === undefined || !Number.isInteger(vars.port) || vars.port < 1024 || vars.port > 65535) {
      throw new CommandPolicyError("Command needs a {port} but no valid port was provided.");
    }
    out = out.replaceAll("{port}", String(vars.port));
  }
  return out;
}

function baseName(executable: string): string {
  const last = executable.split(/[\\/]/).pop() ?? executable;
  return last.replace(/\.(cmd|exe|bat|ps1)$/i, "").toLowerCase();
}

/** The tool an `npx`-style launcher runs: the first argument that is not a flag. Strips an @version suffix. */
function launchedTool(args: string[]): string | undefined {
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    // "@playwright/mcp@1.0" -> "@playwright/mcp", "vite@5" -> "vite"
    const at = arg.lastIndexOf("@");
    return at > 0 ? arg.slice(0, at) : arg;
  }
  return undefined;
}

/**
 * Validate a command line against the allowlist and return the executable plus
 * args. Exported separately so the Playwright MCP launch config can be checked
 * with the same rules (with its own tool allowlist).
 */
export function validateCommandLine(
  commandLine: string,
  opts: { allowedPackageTools?: ReadonlySet<string> } = {},
): { executable: string; args: string[] } {
  if (SHELL_METACHARACTERS.test(commandLine)) {
    throw new CommandPolicyError(
      `Command "${commandLine}" contains shell metacharacters; only plain commands are allowed.`,
    );
  }
  const tokens = tokenize(commandLine);
  const [executable, ...args] = tokens;
  if (!executable) throw new CommandPolicyError("Command is empty.");
  const exe = baseName(executable);
  if (executable.includes("/") || executable.includes("\\")) {
    throw new CommandPolicyError("Executable must be a bare name (e.g. npx), not a path.");
  }
  if (!ALLOWED_EXECUTABLES.has(exe)) {
    throw new CommandPolicyError(
      `Executable "${executable}" is not allowed. Allowed: ${[...ALLOWED_EXECUTABLES].join(", ")}.`,
    );
  }
  const toolAllowlist = opts.allowedPackageTools ?? ALLOWED_PACKAGE_TOOLS;

  if (exe === "npx" || exe === "bunx") {
    const tool = launchedTool(args);
    if (!tool || !toolAllowlist.has(tool)) {
      throw new CommandPolicyError(`${exe} may only run: ${[...toolAllowlist].join(", ")} (got "${tool ?? ""}").`);
    }
  }
  if (exe === "npm" || exe === "pnpm" || exe === "yarn" || exe === "bun") {
    const sub = args.find((a) => !a.startsWith("-"));
    if (!sub) throw new CommandPolicyError(`${exe} needs a subcommand.`);
    if (!ALLOWED_PM_SUBCOMMANDS.has(sub)) {
      // yarn allows `yarn <script>` shorthand; allow only when it is a bare word script name.
      if (!(exe === "yarn" && /^[a-z0-9:_-]+$/i.test(sub) && !["add", "remove", "install", "dlx", "global", "config", "set", "up", "upgrade"].includes(sub))) {
        throw new CommandPolicyError(`${exe} ${sub} is not allowed; use "${exe} run <script>" or "${exe} exec <tool>".`);
      }
    }
    if (sub === "exec" || sub === "dlx" || sub === "x") {
      const rest = args.slice(args.indexOf(sub) + 1);
      const tool = launchedTool(rest.filter((a) => a !== "--"));
      if (!tool || !toolAllowlist.has(tool)) {
        throw new CommandPolicyError(`${exe} ${sub} may only run: ${[...toolAllowlist].join(", ")}.`);
      }
    }
  }
  if (exe === "node") {
    // Only node's own flags (before the script) matter; later args belong to the script.
    const scriptIndex = args.findIndex((a) => !a.startsWith("-"));
    const nodeFlags = scriptIndex === -1 ? args : args.slice(0, scriptIndex);
    const banned = nodeFlags.find((a) => /^(-e|-p|--eval|--print|-r|--require|--import|--loader|--experimental-loader|-i|--interactive)(=|$)/.test(a));
    if (banned) throw new CommandPolicyError(`node ${banned} is not allowed.`);
    const script = scriptIndex === -1 ? undefined : args[scriptIndex];
    if (!script || script.startsWith("/") || /^[a-zA-Z]:/.test(script) || script.split("/").includes("..")) {
      throw new CommandPolicyError("node must run a workspace-relative script.");
    }
  }
  return { executable, args };
}

/** Map a command name the model asked for to a validated executable + args. */
export function resolveCommand(name: string, templates: CommandTemplates, vars: CommandVars): ResolvedCommand {
  if (!(COMMAND_NAMES as readonly string[]).includes(name)) {
    throw new CommandPolicyError(`Unknown command "${name}". Allowed: ${COMMAND_NAMES.join(", ")}.`);
  }
  const commandName = name as CommandName;
  const template = templateFor(commandName, templates).trim();
  if (template === "") {
    throw new CommandPolicyError(`No ${commandName} command is configured.`);
  }
  // Check the template itself (placeholders are the only braces allowed) before substitution.
  const withoutPlaceholders = template.replaceAll("{protoDir}", "x").replaceAll("{port}", "1");
  if (SHELL_METACHARACTERS.test(withoutPlaceholders)) {
    throw new CommandPolicyError(`The configured ${commandName} command contains shell metacharacters.`);
  }
  const line = substitute(template, vars);
  const { executable, args } = validateCommandLine(line);
  return { name: commandName, executable, args, display: [executable, ...args].join(" ") };
}
