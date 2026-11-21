/**
 * Path guard: the code-level enforcement of "the agent writes only inside
 * prototypes/<name>/". The system prompt also says so, but this file is the actual
 * boundary. Every write goes through resolveWritePath(), and the function fails
 * closed: anything it cannot prove safe is rejected.
 *
 * Reads are checked separately (resolveReadPath). They may cover the whole
 * workspace, since the agent needs the component library, but never
 * secrets-like files, VCS internals or anything outside the workspace.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export class PathGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathGuardError";
  }
}

export interface WriteScope {
  /** Absolute workspace root. */
  workspaceRoot: string;
  /** Workspace-relative prototypes folder, e.g. "prototypes". */
  prototypeFolder: string;
  /** Active prototype name (validated with validatePrototypeName). */
  prototypeName: string;
}

const PROTOTYPE_NAME = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

/** Text file types a prototype may contain. Anything else is rejected. */
export const ALLOWED_WRITE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".css",
  ".json",
  ".md",
  ".html",
  ".svg",
  ".txt",
]);

const FORBIDDEN_SEGMENTS = new Set(["node_modules", ".git", ".hg", ".svn", ".vscode"]);

const SECRET_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /^\.npmrc$/i,
  /^\.yarnrc(\.yml)?$/i,
  /^\.netrc$/i,
  /\.(pem|key|p12|pfx|crt|cer|keystore|jks)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^credentials(\.json)?$/i,
  /^secrets?(\..*)?$/i,
];

/**
 * Files that tools *execute* or obey: bundler, linter, compiler and package
 * configs. If the agent could write e.g. prototypes/x/vite.config.mjs or
 * eslint.config.js (ESLint looks up config from the linted file's folder),
 * running the dev server or linter would execute model-written code on the
 * host. Only the harness's own scaffolder may write these, via allowReserved.
 */
const RESERVED_FILE_PATTERNS: RegExp[] = [
  /^package(-lock)?\.json$/i,
  /^(pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i,
  /^tsconfig(\..*)?\.json$/i,
  /^jsconfig(\..*)?\.json$/i,
  /(^|\.)config\.(m?[jt]s|c[jt]s|json)$/i, // vite.config.mjs, eslint.config.js, postcss.config.cjs ...
  /^\.(babelrc|eslintrc|prettierrc|swcrc|postcssrc)(\..*)?$/i,
  /^\.?eslintrc(\..*)?$/i,
];

export function isReservedFile(basename: string): boolean {
  const folded = basename.normalize("NFKC").toLowerCase();
  return RESERVED_FILE_PATTERNS.some((re) => re.test(basename) || re.test(folded));
}

export function validatePrototypeName(name: string): string {
  if (typeof name !== "string" || !PROTOTYPE_NAME.test(name)) {
    throw new PathGuardError(
      `Invalid prototype name "${String(name)}": use 1-64 lowercase letters, digits and hyphens, not starting or ending with a hyphen.`,
    );
  }
  return name;
}

/** Turn free text ("Settings page v2!") into a valid prototype name ("settings-page-v2"). */
export function slugifyPrototypeName(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "prototype";
}

/**
 * Compare names the way a case-insensitive filesystem might: NFKC folds
 * compatibility characters (U+017F "ſ" -> "s", U+212A Kelvin "K" -> "K") and
 * then lower-cases. Without this, "node_moduleſ" or "pacKage.json" slip past
 * ASCII checks while APFS/NTFS open the real thing.
 */
export function foldName(name: string): string {
  return name.normalize("NFKC").toLowerCase();
}

/**
 * Path segments the agent may *write*: ASCII letters, digits, ".", "_", "-".
 * This rules out Unicode look-alikes and Windows 8.3 short names
 * ("VITECO~1.MJS"), at the cost of non-ASCII file names in prototypes.
 */
const SAFE_WRITE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Folder names inside a prototype that only the harness may write to. */
const HARNESS_ONLY_SEGMENTS = new Set([".harness"]);

function isSecretLike(basename: string): boolean {
  const folded = foldName(basename);
  return SECRET_FILE_PATTERNS.some((re) => re.test(basename) || re.test(folded));
}

function assertSafeSegments(p: string, what: string): void {
  for (const segment of p.split("/")) {
    if (segment === "" || segment === "." || segment === "..") continue;
    if (!SAFE_WRITE_SEGMENT.test(segment)) {
      throw new PathGuardError(
        `Refusing ${what} "${p}": use only ASCII letters, digits, ".", "_" and "-" in file and folder names.`,
      );
    }
  }
}

/** Forbidden / reserved / secret checks on the segments of a path inside the prototype. */
function assertAllowedInside(segments: string[], allowReserved: boolean, shown: string): void {
  segments.forEach((segment, i) => {
    const folded = foldName(segment);
    if (FORBIDDEN_SEGMENTS.has(folded)) {
      throw new PathGuardError(`Refusing to write into a "${segment}" folder.`);
    }
    const isLast = i === segments.length - 1;
    if (!isLast && !allowReserved && HARNESS_ONLY_SEGMENTS.has(folded)) {
      throw new PathGuardError(`Refusing to write "${shown}": the ${segment}/ folder is managed by the harness.`);
    }
    if (isSecretLike(segment)) {
      throw new PathGuardError(`Refusing to write a secrets-like file (${segment}).`);
    }
    if (isLast && !allowReserved && (isReservedFile(segment) || isReservedFile(folded))) {
      throw new PathGuardError(
        `Refusing to write "${segment}": build/lint/package config is managed by the harness, because those files are executed by the dev server and tools.`,
      );
    }
  });
}

function assertCleanInput(requested: unknown): string {
  if (typeof requested !== "string" || requested.trim() === "") {
    throw new PathGuardError("Path must be a non-empty string.");
  }
  if (requested.includes("\0")) {
    throw new PathGuardError("Path contains a NUL byte.");
  }
  if (requested.includes("\\")) {
    throw new PathGuardError("Use forward slashes in paths.");
  }
  if (path.isAbsolute(requested) || /^[a-zA-Z]:/.test(requested) || requested.startsWith("~")) {
    throw new PathGuardError("Paths must be workspace-relative, not absolute.");
  }
  return requested;
}

/** True when `child` is `parent` itself or lies inside it (lexically). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** realpath of the deepest existing ancestor of p (p itself if it exists). */
function realpathOfNearestExisting(p: string): { real: string; rest: string[] } {
  let current = p;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return { real, rest };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new PathGuardError(`Cannot resolve ${p}`);
      }
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

function validatePrototypeFolder(folder: string): string {
  const clean = assertCleanInput(folder);
  assertSafeSegments(clean, "prototype folder");
  for (const segment of clean.split("/")) {
    if (FORBIDDEN_SEGMENTS.has(foldName(segment))) {
      throw new PathGuardError(`The prototype folder cannot be inside "${segment}".`);
    }
  }
  return clean;
}

export function prototypeDir(scope: WriteScope): string {
  validatePrototypeName(scope.prototypeName);
  const folder = validatePrototypeFolder(scope.prototypeFolder);
  return path.resolve(scope.workspaceRoot, folder, scope.prototypeName);
}

/**
 * Resolve a workspace-relative path the agent wants to write. Returns the
 * absolute path when it is inside `<workspace>/<prototypeFolder>/<name>/`, and
 * throws PathGuardError otherwise.
 *
 * Checks, in order:
 *  1. input hygiene (string, no NUL, no backslash, not absolute)
 *  2. lexical containment in the active prototype folder (catches `..`)
 *  3. forbidden segments (node_modules, .git, ...) and secret-like names
 *  4. reserved config files (unless the harness scaffolder asks) and allowed file extension
 *  5. symlink containment: the real path of the nearest existing ancestor must
 *     stay inside the real prototype folder, and the target itself must not be
 *     an existing symlink. This stops `prototypes/x/link -> /etc` escapes.
 */
export function resolveWritePath(scope: WriteScope, requested: string, opts: { allowReserved?: boolean } = {}): string {
  const clean = assertCleanInput(requested);
  assertSafeSegments(clean, "to write");
  const root = path.resolve(scope.workspaceRoot);
  const protoFolderAbs = path.resolve(root, validatePrototypeFolder(scope.prototypeFolder));
  const protoAbs = prototypeDir(scope);
  if (!isInside(root, protoFolderAbs) || protoFolderAbs === root) {
    throw new PathGuardError("Prototype folder must be a sub-folder of the workspace.");
  }

  const target = path.resolve(root, clean);
  if (!isInside(protoAbs, target) || target === protoAbs) {
    const relProto = path.relative(root, protoAbs).split(path.sep).join("/");
    throw new PathGuardError(
      `Refusing to write "${clean}": the agent may only write inside ${relProto}/ (paths are workspace-relative, e.g. "${relProto}/screens/Profile.tsx").`,
    );
  }

  const relInside = path.relative(protoAbs, target).split(path.sep);
  assertAllowedInside(relInside, opts.allowReserved === true, clean);
  const base = path.basename(target);
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_WRITE_EXTENSIONS.has(ext)) {
    throw new PathGuardError(
      `Refusing to write "${base}": allowed file types are ${[...ALLOWED_WRITE_EXTENSIONS].join(", ")}.`,
    );
  }

  // Symlink containment. Resolve the real workspace and prototype folders
  // (they may legitimately be behind a symlink, e.g. /tmp -> /private/tmp on
  // macOS), then require the target's nearest existing ancestor to resolve
  // inside the real prototype folder.
  const realRoot = fs.realpathSync.native(root);
  const { real: realProtoFolderBase, rest: protoFolderRest } = realpathOfNearestExisting(protoFolderAbs);
  const realProtoFolder = path.join(realProtoFolderBase, ...protoFolderRest);
  if (!isInside(realRoot, realProtoFolder) || realProtoFolder === realRoot) {
    throw new PathGuardError("Prototype folder resolves outside the workspace (symlink?).");
  }
  const { real: realProtoBase, rest: protoRest } = realpathOfNearestExisting(protoAbs);
  const realProto = path.join(realProtoBase, ...protoRest);
  if (!isInside(realProtoFolder, realProto) || realProto === realProtoFolder) {
    throw new PathGuardError("Prototype directory resolves outside the prototypes folder (symlink?).");
  }
  const { real: realTargetBase, rest: targetRest } = realpathOfNearestExisting(target);
  const realTarget = path.join(realTargetBase, ...targetRest);
  if (!isInside(realProto, realTarget) || realTarget === realProto) {
    throw new PathGuardError(`Refusing to write "${clean}": it resolves outside the prototype folder (symlink?).`);
  }
  // Re-check names on the resolved path too (what the filesystem will actually open).
  assertAllowedInside(path.relative(realProto, realTarget).split(path.sep), opts.allowReserved === true, clean);
  try {
    if (fs.lstatSync(target).isSymbolicLink()) {
      throw new PathGuardError(`Refusing to write through a symlink (${clean}).`);
    }
  } catch (err) {
    if (err instanceof PathGuardError) throw err;
    // ENOENT: the file does not exist yet, which is fine.
  }
  return target;
}

/**
 * Resolve a workspace-relative path the agent wants to read. Reads may cover the
 * whole workspace (the component library lives outside prototypes/), but never
 * leave it, and never return secrets-like files, VCS internals or dependencies.
 */
export function resolveReadPath(workspaceRoot: string, requested: string): string {
  const clean = assertCleanInput(requested === "." ? "./" : requested);
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, clean);
  if (!isInside(root, target)) {
    throw new PathGuardError(`Refusing to read "${clean}": it is outside the workspace.`);
  }
  const rel = path.relative(root, target);
  for (const segment of rel.split(path.sep)) {
    if (segment === "") continue;
    if (FORBIDDEN_SEGMENTS.has(foldName(segment)) && foldName(segment) !== ".vscode") {
      throw new PathGuardError(`Refusing to read inside "${segment}".`);
    }
    if (isSecretLike(segment)) {
      throw new PathGuardError(`Refusing to read a secrets-like file (${segment}).`);
    }
  }
  const realRoot = fs.realpathSync.native(root);
  const { real, rest } = realpathOfNearestExisting(target);
  const realTarget = path.join(real, ...rest);
  if (!isInside(realRoot, realTarget)) {
    throw new PathGuardError(`Refusing to read "${clean}": it resolves outside the workspace (symlink?).`);
  }
  return target;
}

/** Convert an absolute path back to a workspace-relative, forward-slash path. */
export function toWorkspaceRelative(workspaceRoot: string, absolute: string): string {
  return path.relative(path.resolve(workspaceRoot), absolute).split(path.sep).join("/");
}
