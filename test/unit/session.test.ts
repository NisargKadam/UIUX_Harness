import * as fs from "node:fs";
import * as path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, describe, expect, it } from "vitest";
import { pickAdapter } from "../../src/core/adapters/reactVite";
import { AgentSession } from "../../src/core/agent/session";
import { defaultConfig } from "../../src/core/config";
import type { HarnessHost } from "../../src/core/host";
import { McpManager } from "../../src/core/mcp/manager";
import { DevServerManager } from "../../src/core/process/runner";

const WS = path.resolve(__dirname, "../../sample-workspace");
const NAME = "unit-session";
const DIR = path.join(WS, "prototypes", NAME);

/** A stand-in model that just ends the turn. */
function endTurnClient(): Anthropic {
  const stream = () => ({
    on() {
      return this;
    },
    async finalMessage() {
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
    },
  });
  return { beta: { messages: { stream } } } as unknown as Anthropic;
}

describe("AgentSession resilience", () => {
  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

  it("ignores a malformed saved state and never gets stuck in 'running' (review finding)", async () => {
    const config = defaultConfig(WS);
    const host: HarnessHost = {
      emit: () => {},
      askUser: async () => ({ answer: "" }),
      getDiagnostics: async () => [],
      preview: { open: async () => {}, navigate: async () => {}, reload: async () => {} },
      log: () => {},
    };
    const session = new AgentSession({
      client: endTurnClient(),
      config,
      host,
      adapter: pickAdapter(WS, "auto"),
      mcp: new McpManager(config, () => ({ source: "indexer", generatedAt: "", importFrom: "@ds", libraryPath: "", components: [], tokens: [], warnings: [] })),
      devServer: new DevServerManager(),
      system: [{ type: "text", text: "test" }],
    });
    fs.mkdirSync(path.join(DIR, ".harness"), { recursive: true });
    fs.writeFileSync(path.join(DIR, ".harness/state.json"), JSON.stringify({ name: "demo" })); // missing feedback, plan, dates
    session.loadPrototype(NAME);
    expect(session.state.record).toBeUndefined();
    const r1 = await session.send("make it denser");
    expect(r1.outcome).toBe("done");
    expect(session.isRunning).toBe(false);
    const r2 = await session.send("and add an empty state");
    expect(r2.outcome).toBe("done");
  });
});
