/**
 * Loads SKILL.md files. Bundled skills ship with the extension (skills/<name>/SKILL.md);
 * a team can override any of them, or add new ones, in the workspace under
 * .uiux-harness/skills/<name>/SKILL.md. That way the rules that decide output
 * quality can be tuned per design system without a new extension build.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface Skill {
  name: string;
  description: string;
  body: string;
  source: "bundled" | "workspace";
  file: string;
}

/** Minimal frontmatter parser: `key: value` lines between leading `---` fences. */
export function parseSkill(text: string): { meta: Record<string, string>; body: string } {
  const normalised = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalised);
  if (!m) return { meta: {}, body: normalised.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body: m[2]!.trim() };
}

function loadDir(dir: string, source: Skill["source"]): Skill[] {
  if (!fs.existsSync(dir)) return [];
  const skills: Skill[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const { meta, body } = parseSkill(fs.readFileSync(file, "utf8"));
    skills.push({
      name: meta.name ?? entry.name,
      description: meta.description ?? "",
      body,
      source,
      file,
    });
  }
  return skills;
}

/** The order skills appear in the prompt, which follows the order of the workflow. */
export const SKILL_ORDER = ["brief-interpretation", "component-mapping", "prototype-scaffolding", "self-review"];

export function loadSkills(bundledDir: string, workspaceRoot?: string): Skill[] {
  const byName = new Map<string, Skill>();
  for (const s of loadDir(bundledDir, "bundled")) byName.set(s.name, s);
  if (workspaceRoot) {
    for (const s of loadDir(path.join(workspaceRoot, ".uiux-harness", "skills"), "workspace")) byName.set(s.name, s);
  }
  return [...byName.values()].sort((a, b) => {
    const ia = SKILL_ORDER.indexOf(a.name);
    const ib = SKILL_ORDER.indexOf(b.name);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name);
  });
}
