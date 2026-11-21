import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { activityLabel } from "../../src/core/activity";
import { ReactViteAdapter } from "../../src/core/adapters/reactVite";
import { findFigmaUrl, parseFigmaUrl } from "../../src/core/figma";
import { loadSkills, parseSkill } from "../../src/core/skills/loader";

describe("Figma URL parsing", () => {
  it("extracts fileKey and converts node-id dashes to colons", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/AbC123/Checkout?node-id=12-345&t=x")).toMatchObject({ fileKey: "AbC123", nodeId: "12:345", kind: "design" });
  });
  it("uses the branch key for branch URLs", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/MAIN/branch/BR4NCH/Checkout?node-id=1-2")?.fileKey).toBe("BR4NCH");
  });
  it("rejects non-Figma and malformed URLs", () => {
    expect(parseFigmaUrl("https://evil.example/design/x")).toBeUndefined();
    expect(parseFigmaUrl("https://figma.com.evil.example/design/x")).toBeUndefined();
    expect(parseFigmaUrl("not a url")).toBeUndefined();
  });
  it("finds a Figma link inside a brief", () => {
    expect(findFigmaUrl("Build this (https://www.figma.com/design/K3y/App?node-id=4-5) please")?.nodeId).toBe("4:5");
  });
});

describe("activity labels speak designer language", () => {
  it("labels built-in tools", () => {
    expect(activityLabel("write_file", { path: "prototypes/x/screens/CheckoutScreen.tsx" })).toBe("Building the Checkout screen");
    expect(activityLabel("write_file", { path: "prototypes/x/mock/data.ts" })).toBe("Preparing sample data");
    expect(activityLabel("write_file", { path: "prototypes/x/App.tsx" })).toBe("Wiring up navigation between screens");
    expect(activityLabel("run_command", { command: "typecheck" })).toBe("Checking the prototype for errors");
    expect(activityLabel("read_file", { path: "src/components/TextField.tsx" })).toBe("Looking at the Text Field component");
    expect(activityLabel("ask_user", { plan: {} })).toBe("Waiting for your OK on the plan");
  });
  it("labels MCP tools without exposing tool names", () => {
    expect(activityLabel("playwright__browser_click", { element: "Save changes button" })).toBe("Clicking “Save changes button”");
    expect(activityLabel("playwright__browser_navigate", { url: "http://127.0.0.1:5180/#/settings/notifications" })).toBe("Visiting the settings › notifications screen");
    expect(activityLabel("figma__get_screenshot", {})).toBe("Taking a picture of the Figma frame");
    expect(activityLabel("catalogue__get_component", { name: "Tabs" })).toBe("Looking up the Tabs component");
  });
  it("prefers the model's own label", () => {
    expect(activityLabel("write_file", { path: "x", activity: "Checking the checkout flow" })).toBe("Checking the checkout flow");
  });
});

describe("React + Vite adapter", () => {
  const a = new ReactViteAdapter();
  it("builds hash-route URLs", () => {
    expect(a.routeUrl("http://127.0.0.1:5180/", "/settings/notifications")).toBe("http://127.0.0.1:5180/#/settings/notifications");
    expect(a.routeUrl("http://127.0.0.1:5180", "settings")).toBe("http://127.0.0.1:5180/#/settings");
    expect(a.routeUrl("http://127.0.0.1:5180/#/old", "/")).toBe("http://127.0.0.1:5180/");
  });
  it("parses tsc output including continuation lines", () => {
    const out = a.parseTypecheckOutput(
      "prototypes/x/App.tsx(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n  The expected type comes from property 'gap'.\nsrc/components/Button.tsx(1,1): error TS1000: lib problem",
      "/ws",
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ file: "prototypes/x/App.tsx", line: 3, column: 7, code: "TS2322" });
    expect(out[0]!.message).toContain("expected type comes from property");
  });
  it("parses eslint stylish output", () => {
    const out = a.parseLintOutput("/ws/prototypes/x/App.tsx\n  4:10  error  'x' is assigned a value but never used  @typescript-eslint/no-unused-vars\n\n✖ 1 problem", "/ws");
    expect(out).toEqual([expect.objectContaining({ file: "prototypes/x/App.tsx", line: 4, severity: "error", code: "@typescript-eslint/no-unused-vars" })]);
  });
});

describe("skills loader", () => {
  it("parses frontmatter", () => {
    expect(parseSkill("---\nname: a\ndescription: \"does b\"\n---\n# Body")).toEqual({ meta: { name: "a", description: "does b" }, body: "# Body" });
  });
  it("loads the four bundled skills in workflow order, with substance", () => {
    const skills = loadSkills(path.resolve(__dirname, "../../skills"));
    expect(skills.map((s) => s.name)).toEqual(["brief-interpretation", "component-mapping", "prototype-scaffolding", "self-review"]);
    for (const s of skills) {
      expect(s.description.length).toBeGreaterThan(40);
      expect(s.body).toMatch(/## Worked example/);
      expect(s.body.length).toBeGreaterThan(3000);
    }
  });
  it("lets a workspace override a bundled skill", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "uiux-skills-"));
    fs.mkdirSync(path.join(ws, ".uiux-harness/skills/self-review"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".uiux-harness/skills/self-review/SKILL.md"), "---\nname: self-review\ndescription: team rules\n---\nOur rules.");
    const skills = loadSkills(path.resolve(__dirname, "../../skills"), ws);
    const review = skills.find((s) => s.name === "self-review")!;
    expect(review.source).toBe("workspace");
    expect(review.body).toBe("Our rules.");
    fs.rmSync(ws, { recursive: true, force: true });
  });
});
