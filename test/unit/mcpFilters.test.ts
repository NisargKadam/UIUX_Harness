import { describe, expect, it } from "vitest";
import { convertContent, isToolAllowed } from "../../src/core/mcp/manager";

describe("MCP tool filters", () => {
  it("only exposes read tools from Figma", () => {
    for (const t of ["get_design_context", "get_metadata", "get_screenshot", "get_variable_defs", "search_design_system", "whoami"]) {
      expect(isToolAllowed("figma", t)).toBe(true);
    }
    for (const t of ["use_figma", "upload_assets", "create_new_file", "generate_figma_design", "add_code_connect_map"]) {
      expect(isToolAllowed("figma", t)).toBe(false);
    }
  });
  it("drops code-execution and file tools from Playwright", () => {
    expect(isToolAllowed("playwright", "browser_navigate")).toBe(true);
    expect(isToolAllowed("playwright", "browser_take_screenshot")).toBe(true);
    expect(isToolAllowed("playwright", "browser_run_code_unsafe")).toBe(false);
    expect(isToolAllowed("playwright", "browser_file_upload")).toBe(false);
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
