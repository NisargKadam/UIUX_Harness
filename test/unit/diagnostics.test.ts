import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pickAdapter } from "../../src/core/adapters/reactVite";
import type { Diagnostic } from "../../src/core/adapters/types";
import { SessionState } from "../../src/core/agent/state";
import { defaultConfig } from "../../src/core/config";
import type { HarnessHost } from "../../src/core/host";
import { DevServerManager } from "../../src/core/process/runner";
import { findBuiltin, mergeDiagnostics } from "../../src/core/tools/builtin";

const WS = path.resolve(__dirname, "../../sample-workspace");
const NAME = "unit-diagnostics";
const DIR = path.join(WS, "prototypes", NAME);

describe("get_diagnostics", () => {
  const config = defaultConfig(WS);
  const adapter = pickAdapter(WS, "auto");
  const state = new SessionState(config, adapter);
  const editorDiag: Diagnostic = { file: `prototypes/${NAME}/App.tsx`, line: 1, column: 1, severity: "warning", message: "Unexpected console statement", source: "eslint" };
  const host: HarnessHost = {
    emit: () => {},
    askUser: async () => ({ answer: "" }),
    getDiagnostics: async () => [editorDiag],
    preview: { open: async () => {}, navigate: async () => {}, reload: async () => {} },
    log: () => {},
  };

  beforeAll(() => {
    fs.rmSync(DIR, { recursive: true, force: true });
    state.activate(NAME);
    fs.writeFileSync(path.join(DIR, "App.tsx"), 'import { Button } from "@ds";\nexport function App() { return <Button variant="huge">x</Button>; }\n');
  });
  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

  it("merges editor diagnostics with a full type check, so files not open in an editor are covered", async () => {
    const tool = findBuiltin("get_diagnostics")!;
    const out = await tool.run({}, { config, adapter, host, devServer: new DevServerManager(), state, signal: new AbortController().signal });
    const text = String(out.content);
    expect(out.isError).toBe(true);
    expect(text).toContain("Unexpected console statement"); // from the editor
    expect(text).toMatch(/TS2322.*huge/); // from tsc
    expect(text).toMatch(/1 from the editor, 1 from the type checker/);
  });

  it("de-duplicates the same problem reported by both sources", () => {
    const d: Diagnostic = { file: "a.tsx", line: 2, column: 3, severity: "error", message: "Type 'x' is not assignable", source: "ts" };
    expect(mergeDiagnostics([d], [{ ...d, source: "typescript" }])).toHaveLength(1);
  });
});
