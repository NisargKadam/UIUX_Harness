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
 *  - npx / npm exec / pnpm dlx may run only allowlisted tools, given as a plain
 *    package name (no --package/--registry flags, git/url/npm: specs)
 *  - package managers may only `run` workspace scripts or `exec` allowlisted tools
 *  - node may only run a bin script under node_modules/, with no node flags
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

/** Flags a launcher (npx, bunx, `npm exec`, `pnpm dlx`...) may receive before the tool name. */
// Boolean flags only. (npm parses a bare "--no" as taking the next argument as its value, so it is excluded.)
const SAFE_LAUNCHER_FLAGS = new Set(["-y", "--yes", "--yes=false", "--no-install", "--quiet", "--silent", "--"]);

/** "name", "@scope/name", optionally "@<version>" where the version is plain semver-ish (no URLs, git, npm: aliases). */
const PACKAGE_SPEC = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(@\d[0-9A-Za-z.+-]*)?$/;

/**
 * Validate a launcher invocation: only safe flags before the tool, and the tool
 * must be a plain allowlisted package spec. Flags after the tool belong to the
 * tool (e.g. `vite --config ...`).
 */
function checkLauncher(label: string, args: string[], allow: ReadonlySet<string>): void {
  const toolIndex = args.findIndex((a) => !a.startsWith("-"));
  for (const flag of toolIndex === -1 ? args : args.slice(0, toolIndex)) {
    if (!SAFE_LAUNCHER_FLAGS.has(flag)) throw new CommandPolicyError(`${label}: flag "${flag}" is not allowed before the tool name.`);
  }
  const spec = toolIndex === -1 ? undefined : args[toolIndex];
  if (!spec || !PACKAGE_SPEC.test(spec)) {
    throw new CommandPolicyError(`${label} must run a plain package name (optionally @version), got "${spec ?? ""}".`);
  }
  const at = spec.lastIndexOf("@");
  const name = at > 0 ? spec.slice(0, at) : spec;
  if (!allow.has(name)) throw new CommandPolicyError(`${label} may only run: ${[...allow].join(", ")} (got "${name}").`);
}

/** Subcommands each package manager may use. Scripts come from the workspace's own package.json. */
const PM_SUBCOMMANDS: Record<string, string[]> = {
  npm: ["run", "exec"],
  pnpm: ["run", "exec", "dlx"],
  yarn: ["run", "exec", "dlx"],
  bun: ["run", "x"],
};

/**
 * Validate a command given as executable + argv (as it will be spawned). Each
 * element is checked on its own, so quoting tricks in a joined string cannot
 * smuggle extra arguments.
 */
export function validateArgv(executable: string, args: string[], opts: { allowedPackageTools?: ReadonlySet<string> } = {}): { executable: string; args: string[] } {
  for (const token of [executable, ...args]) {
    if (typeof token !== "string" || token === "" || /[\s"']/.test(token) || SHELL_METACHARACTERS.test(token)) {
      throw new CommandPolicyError(`Unsafe command argument ${JSON.stringify(token)}.`);
    }
  }
  return validateCommandLine([executable, ...args].join(" "), opts);
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
    checkLauncher(exe, args, toolAllowlist);
  }
  if (exe in PM_SUBCOMMANDS) {
    const [sub, ...rest] = args;
    if (!sub || sub.startsWith("-")) throw new CommandPolicyError(`${exe} needs a subcommand first (flags before it are not allowed).`);
    if (!PM_SUBCOMMANDS[exe]!.includes(sub)) {
      throw new CommandPolicyError(`${exe} ${sub} is not allowed; use ${PM_SUBCOMMANDS[exe]!.map((c) => `"${exe} ${c} …"`).join(" or ")}.`);
    }
    if (sub === "run") {
      const script = rest[0];
      if (!script || !/^[A-Za-z0-9:_-]+$/.test(script)) throw new CommandPolicyError(`${exe} run needs a plain script name.`);
    } else {
      checkLauncher(`${exe} ${sub}`, rest, toolAllowlist);
    }
  }
  if (exe === "node") {
    // node may only run a tool's own bin script from node_modules (which the agent cannot write), with no node flags.
    const script = args[0];
    if (!script || script.startsWith("-")) throw new CommandPolicyError("node flags are not allowed; give a script path first.");
    if (!/^node_modules\/[A-Za-z0-9@._/-]+$/.test(script) || script.split("/").includes("..")) {
      throw new CommandPolicyError("node may only run a script under node_modules/ (e.g. node_modules/typescript/bin/tsc).");
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
