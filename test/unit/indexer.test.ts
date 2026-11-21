import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatCatalogueForPrompt, indexComponents, indexTokens } from "../../src/core/catalogue/indexer";
import type { Catalogue } from "../../src/core/catalogue/types";

const SAMPLE = path.resolve(__dirname, "../../sample-workspace");

describe("indexer on the sample workspace", () => {
  let cat: Catalogue;
  beforeAll(() => {
    cat = indexComponents({ workspaceRoot: SAMPLE, libraryPath: "src/components", tokensPath: "src/tokens", importFrom: "@ds" });
  });

  it("finds exactly the 12 public components from the library index", () => {
    expect(cat.components.map((c) => c.name)).toEqual([
      "Alert",
      "Avatar",
      "Button",
      "Card",
      "Modal",
      "Select",
      "Stack",
      "Switch",
      "Table",
      "Tabs",
      "Text",
      "TextField",
    ]);
    expect(cat.warnings).toEqual([]);
  });

  it("does not index internal helpers or types", () => {
    const names = cat.components.map((c) => c.name);
    expect(names).not.toContain("cx");
    expect(names).not.toContain("ButtonProps");
  });

  it("extracts own props with literal values resolved through aliases and defaults from destructuring", () => {
    const button = cat.components.find((c) => c.name === "Button")!;
    const variant = button.props.find((p) => p.name === "variant")!;
    expect(variant.values).toEqual(['"primary"', '"secondary"', '"ghost"', '"danger"']);
    expect(variant.required).toBe(false);
    expect(variant.defaultValue).toBe('"primary"');
    expect(variant.description).toMatch(/one primary button per view/);
    // DOM attributes are summarised, not expanded.
    expect(button.props.find((p) => p.name === "onClick")).toBeUndefined();
    expect(button.inherits).toContain("ButtonHTMLAttributes");
    expect(button.category).toBe("Actions");
    expect(button.examples[0]).toContain("<Button");
  });

  it("marks required props and function types", () => {
    const tf = cat.components.find((c) => c.name === "TextField")!;
    const label = tf.props.find((p) => p.name === "label")!;
    expect(label.required).toBe(true);
    expect(tf.props.find((p) => p.name === "onChange")!.type).toBe("(value: string) => void");
    // required props sort first
    expect(tf.props[0]!.required).toBe(true);
  });

  it("handles generic components (Table<Row>)", () => {
    const table = cat.components.find((c) => c.name === "Table")!;
    const density = table.props.find((p) => p.name === "density")!;
    expect(density.values).toEqual(['"comfortable"', '"compact"']);
    expect(table.props.find((p) => p.name === "rows")!.required).toBe(true);
  });

  it("indexes numeric literal unions (Stack gap)", () => {
    const stack = cat.components.find((c) => c.name === "Stack")!;
    expect(stack.props.find((p) => p.name === "gap")!.values).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("reads tokens from CSS custom properties", () => {
    const primary = cat.tokens.find((t) => t.name === "--color-primary")!;
    expect(primary.value).toBe("#3a5bd9");
    expect(primary.group).toBe("color");
    expect(cat.tokens.filter((t) => t.group === "space")).toHaveLength(9);
  });

  it("renders a compact prompt summary", () => {
    const text = formatCatalogueForPrompt(cat);
    expect(text).toContain('Import every component from "@ds"');
    expect(text).toContain('- Button [Actions]:');
    expect(text).toMatch(/variant\?: "primary"\|"secondary"\|"ghost"\|"danger" = "primary"/);
    expect(text).toContain("--color-primary");
  });
});

describe("indexer on synthetic libraries", () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "uiux-index-"));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("without an index file, indexes every exported PascalCase component and skips stories/tests", () => {
    const lib = path.join(dir, "lib1");
    fs.mkdirSync(lib);
    fs.writeFileSync(
      path.join(lib, "Badge.tsx"),
      `/** Small status label. */\nexport function Badge(props: { tone?: "neutral" | "good"; label: string }) { return <span>{props.label}</span>; }\nexport const helper = () => 1;`,
    );
    fs.writeFileSync(path.join(lib, "Badge.stories.tsx"), `export const Primary = () => <div />;`);
    fs.writeFileSync(path.join(lib, "Badge.test.tsx"), `export const Fake = () => <div />;`);
    const cat = indexComponents({ workspaceRoot: dir, libraryPath: "lib1", importFrom: "lib1" });
    expect(cat.components.map((c) => c.name)).toEqual(["Badge"]);
    const badge = cat.components[0]!;
    expect(badge.description).toBe("Small status label.");
    expect(badge.props.map((p) => p.name)).toEqual(["label", "tone"]);
    expect(badge.props[1]!.values).toEqual(['"neutral"', '"good"']);
  });

  it("warns when the folder is missing or has no components", () => {
    expect(indexComponents({ workspaceRoot: dir, libraryPath: "missing", importFrom: "x" }).warnings[0]).toMatch(/does not exist/);
    const empty = path.join(dir, "empty");
    fs.mkdirSync(empty);
    fs.writeFileSync(path.join(empty, "util.ts"), "export const add = (a: number, b: number) => a + b;");
    expect(indexComponents({ workspaceRoot: dir, libraryPath: "empty", importFrom: "x" }).warnings[0]).toMatch(/No React components/);
  });

  it("reads tokens from W3C-style JSON and TS objects", () => {
    const tokDir = path.join(dir, "tokens");
    fs.mkdirSync(tokDir);
    fs.writeFileSync(path.join(tokDir, "tokens.json"), JSON.stringify({ color: { brand: { $value: "#123456" } }, space: { sm: "4px" } }));
    fs.writeFileSync(path.join(tokDir, "radius.ts"), `export const radius = { sm: "2px", lg: 8 } as const;`);
    const tokens = indexTokens(dir, "tokens");
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "color.brand", value: "#123456", group: "color" }),
        expect.objectContaining({ name: "space.sm", value: "4px", group: "space" }),
        expect.objectContaining({ name: "radius.sm", value: "2px", group: "radius" }),
        expect.objectContaining({ name: "radius.lg", value: "8", group: "radius" }),
      ]),
    );
  });
});
