import * as fs from "node:fs";
import * as path from "node:path";
import type { FrameworkAdapter } from "../adapters/types";
import type { HarnessConfig } from "../config";
import { resolveWritePath, toWorkspaceRelative, validatePrototypeName, type WriteScope } from "../policy/pathGuard";
import { prototypeRecordSchema } from "../planSchema";
import type { MissingComponent, PrototypePlan } from "../protocol";

/** Persisted next to the prototype so follow-up sessions can pick up where the last one stopped. */
export interface PrototypeRecord {
  name: string;
  brief: string;
  figmaUrl?: string;
  plan?: PrototypePlan;
  missingComponents: MissingComponent[];
  feedback: string[];
  createdAt: string;
  updatedAt: string;
}

/** Mutable state of one chat session (one prototype at a time). */
export class SessionState {
  prototype: string | undefined;
  record: PrototypeRecord | undefined;
  /** Per request: */
  writeSeq = 0;
  lastCleanCheckSeq = -1;
  lastReviewSeq = -1;
  questionsAsked = 0;
  filesWritten = new Set<string>();
  /** The brief of the request that will create the prototype (before a plan exists). */
  pendingBrief = "";
  pendingFigmaUrl: string | undefined;

  constructor(
    readonly config: HarnessConfig,
    readonly adapter: FrameworkAdapter,
  ) {}

  get protoRelDir(): string | undefined {
    return this.prototype ? `${this.config.prototypeFolder.replace(/\/$/, "")}/${this.prototype}` : undefined;
  }

  writeScope(): WriteScope {
    if (!this.prototype) {
      throw new Error(
        "No prototype is active yet. Present your plan with ask_user (with plan.prototypeName) and wait for the designer's approval before writing files.",
      );
    }
    return { workspaceRoot: this.config.workspaceRoot, prototypeFolder: this.config.prototypeFolder, prototypeName: this.prototype };
  }

  startRequest(): void {
    this.questionsAsked = 0;
    this.filesWritten.clear();
  }

  /** Pick a free prototype name: "settings", then "settings-2", ... (an existing prototype owned by this session is reused). */
  uniqueName(requested: string): string {
    const base = validatePrototypeName(requested);
    if (base === this.prototype) return base;
    const folder = path.join(this.config.workspaceRoot, this.config.prototypeFolder);
    let candidate = base;
    for (let i = 2; fs.existsSync(path.join(folder, candidate)); i++) candidate = `${base}-${i}`;
    return candidate;
  }

  /** Make `name` the active prototype and write the framework plumbing files. */
  activate(name: string): string[] {
    this.prototype = validatePrototypeName(name);
    return this.scaffold();
  }

  /** (Re)write the deterministic plumbing. Reserved files can only be written here. */
  scaffold(): string[] {
    const scope = this.writeScope();
    const protoRelDir = this.protoRelDir!;
    const written: string[] = [];
    for (const file of this.adapter.baseFiles({ config: this.config, protoName: this.prototype!, protoRelDir })) {
      const abs = resolveWritePath(scope, file.path, { allowReserved: true });
      if (!file.overwrite && fs.existsSync(abs)) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, file.content);
      written.push(toWorkspaceRelative(this.config.workspaceRoot, abs));
    }
    return written;
  }

  private recordPath(): string {
    // .harness/ is reserved: only the harness itself writes here, never the agent.
    return resolveWritePath(this.writeScope(), `${this.protoRelDir}/.harness/state.json`, { allowReserved: true });
  }

  saveRecord(): void {
    if (!this.record || !this.prototype) return;
    this.record.updatedAt = new Date().toISOString();
    const file = this.recordPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(this.record, null, 2)}\n`);
  }

  /** Load an existing prototype (for follow-up feedback in a new session). */
  load(name: string): PrototypeRecord | undefined {
    this.prototype = validatePrototypeName(name);
    try {
      const parsed = prototypeRecordSchema.safeParse(JSON.parse(fs.readFileSync(this.recordPath(), "utf8")));
      this.record = parsed.success ? (parsed.data as PrototypeRecord) : undefined;
    } catch {
      this.record = undefined;
    }
    this.scaffold();
    return this.record;
  }

  /** Workspace-relative list of files in the active prototype (for context in follow-ups). */
  listFiles(): string[] {
    if (!this.protoRelDir) return [];
    const root = path.join(this.config.workspaceRoot, this.protoRelDir);
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
        if (e.name === "node_modules" || e.name === "dist" || e.name === ".harness") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else out.push(toWorkspaceRelative(this.config.workspaceRoot, full));
      }
    };
    walk(root);
    return out.sort();
  }
}

/** Names of the prototypes that exist in the workspace. */
export function listPrototypes(config: HarnessConfig): string[] {
  const folder = path.join(config.workspaceRoot, config.prototypeFolder);
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(e.name))
    .map((e) => e.name)
    .sort();
}

export function renderMissingComponentsDoc(plan: PrototypePlan): string {
  const lines = [
    `# Missing components: ${plan.title}`,
    "",
    "The prototype needed these, and the component library has nothing that fits. Each one is stood in for by the closest existing primitive, so the prototype stays buildable. Engineering can use this list to decide what to add to the design system.",
    "",
  ];
  if (plan.missingComponents.length === 0) {
    lines.push("_None. Every element maps to an existing component._");
  } else {
    lines.push("| Needed | Using instead | Why nothing fits | Screens |", "|---|---|---|---|");
    for (const m of plan.missingComponents) {
      lines.push(`| ${m.need} | ${m.usingInstead} | ${m.reason} | ${(m.screens ?? []).join(", ")} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}
