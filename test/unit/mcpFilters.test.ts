import { describe, expect, it } from "vitest";
import { convertContent, isToolAllowed, stripParams } from "../../src/core/mcp/manager";

describe("MCP tool filters", () => {
  it("only exposes read tools from Figma", () => {
    for (const t of ["get_design_context", "get_metadata", "get_screenshot", "get_variable_defs", "search_design_system", "whoami"]) {
      expect(isToolAllowed("figma", t)).toBe(true);
    }
    for (const t of ["use_figma", "upload_assets", "create_new_file", "generate_figma_design", "add_code_connect_map"]) {
      expect(isToolAllowed("figma", t)).toBe(false);
    }
  });
  it("allow-lists Playwright tools: no code evaluation, uploads, storage or network dumps", () => {
    for (const t of ["browser_navigate", "browser_click", "browser_snapshot", "browser_take_screenshot", "browser_console_messages"]) {
      expect(isToolAllowed("playwright", t)).toBe(true);
    }
    for (const t of ["browser_run_code_unsafe", "browser_evaluate", "browser_file_upload", "browser_storage_state", "browser_network_requests", "browser_some_future_tool"]) {
      expect(isToolAllowed("playwright", t)).toBe(false);
    }
  });
  it("strips Playwright's file-writing `filename` parameter from schemas (review finding)", () => {
    const schema = { type: "object", properties: { type: { type: "string" }, filename: { type: "string" } }, required: ["filename"] };
    const out = stripParams("playwright", schema);
    expect(Object.keys(out.properties as object)).toEqual(["type"]);
    expect(out.required).toEqual([]);
    expect(stripParams("figma", schema)).toBe(schema);
  });
  it("only exposes Storybook's read-only docs tools from the catalogue", () => {
    expect(isToolAllowed("catalogue", "docs-list")).toBe(true);
    expect(isToolAllowed("catalogue", "docs-show")).toBe(true);
    expect(isToolAllowed("catalogue", "stories-find-by-component")).toBe(true);
    expect(isToolAllowed("catalogue", "test-run")).toBe(false);
    expect(isToolAllowed("catalogue", "review-create")).toBe(false);
  });
});

describe("convertContent", () => {
  it("maps text and images, caps images and drops unsupported types", () => {
    const img = { type: "image", data: "AAAA", mimeType: "image/png" };
    const out = convertContent([{ type: "text", text: "hi" }, img, img, img, img, { type: "image", data: "x", mimeType: "image/bmp" }]);
    expect(out.filter((b) => b.type === "image")).toHaveLength(3);
    expect(out[0]).toEqual({ type: "text", text: "hi" });
    expect(JSON.stringify(out)).toContain("image omitted");
  });
  it("truncates very long text", () => {
    const out = convertContent([{ type: "text", text: "x".repeat(50_000) }]);
    expect((out[0] as { text: string }).text.length).toBeLessThan(31_000);
  });
  it("never returns empty content", () => {
    expect(convertContent([])).toEqual([{ type: "text", text: "(no output)" }]);
  });
});
