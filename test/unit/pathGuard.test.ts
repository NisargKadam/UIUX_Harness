import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PathGuardError,
  resolveReadPath,
  resolveWritePath,
  slugifyPrototypeName,
  validatePrototypeName,
  type WriteScope,
} from "../../src/core/policy/pathGuard";

let root: string;
let scope: WriteScope;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "uiux-guard-"));
  fs.mkdirSync(path.join(root, "prototypes", "settings"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "components", "Button.tsx"), "export {}");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
  scope = { workspaceRoot: root, prototypeFolder: "prototypes", prototypeName: "settings" };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("resolveWritePath — allowed", () => {
  it("allows a file directly inside the active prototype", () => {
    expect(resolveWritePath(scope, "prototypes/settings/App.tsx")).toBe(path.join(root, "prototypes", "settings", "App.tsx"));
  });

  it("allows nested folders that do not exist yet", () => {
    const p = resolveWritePath(scope, "prototypes/settings/screens/profile/ProfileScreen.tsx");
    expect(p).toBe(path.join(root, "prototypes/settings/screens/profile/ProfileScreen.tsx"));
  });

  it("allows a prototype folder that does not exist yet", () => {
    const s = { ...scope, prototypeName: "brand-new" };
    expect(resolveWritePath(s, "prototypes/brand-new/App.tsx")).toBe(path.join(root, "prototypes/brand-new/App.tsx"));
  });

  it("normalises harmless ./ and inner .. that stay inside", () => {
    expect(resolveWritePath(scope, "./prototypes/settings/screens/../App.tsx")).toBe(path.join(root, "prototypes/settings/App.tsx"));
  });

  it("respects a custom prototype folder", () => {
    const s = { ...scope, prototypeFolder: "design/protos" };
    expect(resolveWritePath(s, "design/protos/settings/index.html")).toBe(path.join(root, "design/protos/settings/index.html"));
  });
});

describe("resolveWritePath — rejected", () => {
  const rejects = (p: string, s: WriteScope = scope) => expect(() => resolveWritePath(s, p)).toThrow(PathGuardError);

  it("rejects parent-directory escapes", () => {
    rejects("prototypes/settings/../../src/components/Button.tsx");
    rejects("../outside.tsx");
    rejects("prototypes/../package.json");
  });

  it("rejects files outside the prototype folder", () => {
    rejects("src/components/Button.tsx");
    rejects("package.json");
    rejects("App.tsx"); // relative to workspace root, not prototype
  });

  it("rejects sibling prototypes (only the active one is writable)", () => {
    rejects("prototypes/other/App.tsx");
    rejects("prototypes/settings-old/App.tsx"); // prefix trick
  });

  it("rejects the prototypes folder and prototype folder themselves", () => {
    rejects("prototypes/README.md");
    rejects("prototypes/settings");
  });

  it("rejects absolute paths, home paths, drive letters and backslashes", () => {
    rejects(path.join(root, "prototypes/settings/App.tsx"));
    rejects("/etc/passwd");
    rejects("~/App.tsx");
    rejects("C:/Windows/x.tsx");
    rejects("prototypes\\settings\\App.tsx");
  });

  it("rejects empty paths and NUL bytes", () => {
    rejects("");
    rejects("   ");
    rejects("prototypes/settings/App.tsx\0.png");
  });

  it("rejects secrets-like files even inside the prototype", () => {
    rejects("prototypes/settings/.env");
    rejects("prototypes/settings/.env.local");
    rejects("prototypes/settings/.npmrc");
    rejects("prototypes/settings/server.key");
  });

  it("rejects forbidden folders inside the prototype", () => {
    rejects("prototypes/settings/node_modules/react/index.js");
    rejects("prototypes/settings/.git/config.txt");
  });

  it("rejects disallowed file types", () => {
    rejects("prototypes/settings/run.sh");
    rejects("prototypes/settings/binary.exe");
    rejects("prototypes/settings/Makefile");
  });

  it("rejects config files that tools would execute (vite/eslint/package/tsconfig)", () => {
    rejects("prototypes/settings/vite.config.mjs");
    rejects("prototypes/settings/vite.config.ts");
    rejects("prototypes/settings/eslint.config.js");
    rejects("prototypes/settings/postcss.config.cjs");
    rejects("prototypes/settings/package.json");
    rejects("prototypes/settings/tsconfig.json");
    rejects("prototypes/settings/nested/tsconfig.app.json");
    rejects("prototypes/settings/.babelrc");
  });

  it("lets the harness scaffolder write reserved plumbing with allowReserved", () => {
    expect(resolveWritePath(scope, "prototypes/settings/vite.config.mjs", { allowReserved: true })).toBe(
      path.join(root, "prototypes/settings/vite.config.mjs"),
    );
    // ...but never outside the prototype, even then.
    expect(() => resolveWritePath(scope, "vite.config.mjs", { allowReserved: true })).toThrow(PathGuardError);
  });

  it("rejects writing through a symlinked directory that points outside", () => {
    fs.symlinkSync(path.join(root, "src"), path.join(root, "prototypes", "settings", "escape"));
    rejects("prototypes/settings/escape/components/Button.tsx");
  });

  it("rejects writing to an existing symlinked file", () => {
    fs.writeFileSync(path.join(root, "target.ts"), "x");
    fs.symlinkSync(path.join(root, "target.ts"), path.join(root, "prototypes", "settings", "link.ts"));
    rejects("prototypes/settings/link.ts");
  });

  it("rejects when the prototype directory itself is a symlink out of the prototypes folder", () => {
    fs.symlinkSync(path.join(root, "src"), path.join(root, "prototypes", "evil"));
    rejects("prototypes/evil/components/Button.tsx", { ...scope, prototypeName: "evil" });
  });

  it("rejects when the prototypes folder is a symlink out of the workspace", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "uiux-outside-"));
    try {
      fs.symlinkSync(outside, path.join(root, "linked-protos"));
      rejects("linked-protos/settings/App.tsx", { ...scope, prototypeFolder: "linked-protos" });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a prototype folder that is the workspace root or outside it", () => {
    rejects("settings/App.tsx", { ...scope, prototypeFolder: "." });
    rejects("../x/settings/App.tsx", { ...scope, prototypeFolder: "../x" });
  });

  it("rejects invalid prototype names", () => {
    rejects("prototypes/../App.tsx", { ...scope, prototypeName: ".." });
    rejects("prototypes/A/App.tsx", { ...scope, prototypeName: "A" });
    rejects("prototypes/a b/App.tsx", { ...scope, prototypeName: "a b" });
  });
});

describe("prototype names", () => {
  it("validates names", () => {
    expect(validatePrototypeName("settings-v2")).toBe("settings-v2");
    expect(() => validatePrototypeName("-bad")).toThrow(PathGuardError);
    expect(() => validatePrototypeName("bad-")).toThrow(PathGuardError);
    expect(() => validatePrototypeName("a".repeat(65))).toThrow(PathGuardError);
  });

  it("slugifies free text into a valid name", () => {
    expect(slugifyPrototypeName("Settings page — v2!")).toBe("settings-page-v2");
    expect(slugifyPrototypeName("Café Checkout")).toBe("cafe-checkout");
    expect(slugifyPrototypeName("!!!")).toBe("prototype");
    expect(() => validatePrototypeName(slugifyPrototypeName("x".repeat(100)))).not.toThrow();
  });
});

describe("resolveReadPath", () => {
  it("allows reading the component library and prototypes", () => {
    expect(resolveReadPath(root, "src/components/Button.tsx")).toBe(path.join(root, "src/components/Button.tsx"));
    expect(resolveReadPath(root, ".")).toBe(root);
  });

  it("rejects reads outside the workspace, of secrets, VCS and dependencies", () => {
    expect(() => resolveReadPath(root, "../etc/passwd")).toThrow(PathGuardError);
    expect(() => resolveReadPath(root, ".env")).toThrow(PathGuardError);
    expect(() => resolveReadPath(root, ".git/config")).toThrow(PathGuardError);
    expect(() => resolveReadPath(root, "node_modules/react/package.json")).toThrow(PathGuardError);
  });

  it("rejects reads through a symlink that leaves the workspace", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "uiux-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "x");
      fs.symlinkSync(outside, path.join(root, "out"));
      expect(() => resolveReadPath(root, "out/secret.txt")).toThrow(PathGuardError);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
