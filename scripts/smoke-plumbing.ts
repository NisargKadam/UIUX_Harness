/** Smoke test of the deterministic plumbing (no model): scaffold → checks → dev server → MCP. */
import * as fs from "node:fs";
import * as path from "node:path";
import { pickAdapter } from "../src/core/adapters/reactVite";
import { SessionState } from "../src/core/agent/state";
import { defaultConfig } from "../src/core/config";
import { buildCatalogue } from "../src/core/harness";
import { McpManager } from "../src/core/mcp/manager";
import { resolveCommand } from "../src/core/policy/commandPolicy";
import { DevServerManager, findFreePort } from "../src/core/process/runner";
import { formatCheck, runCheck } from "../src/core/tools/checks";

async function main() {
  const ws = path.resolve("sample-workspace");
  const config = defaultConfig(ws);
  const adapter = pickAdapter(ws, "auto");
  const state = new SessionState(config, adapter);
  fs.rmSync(path.join(ws, "prototypes/smoke"), { recursive: true, force: true });
  console.log("scaffolded:", state.activate("smoke"));
  const dir = path.join(ws, "prototypes/smoke");
  fs.mkdirSync(path.join(dir, "screens"), { recursive: true });
  fs.writeFileSync(path.join(dir, "screens/HomeScreen.tsx"), `import { Button, Stack, Text } from "@ds";
import { navigate } from "../router";
export function HomeScreen() {
  return (<Stack gap={4} padding={6}><Text variant="title" as="h1">Home</Text><Button onClick={() => navigate("/about")}>About</Button></Stack>);
}
`);
  fs.writeFileSync(path.join(dir, "App.tsx"), `import { Router } from "./router";
import { HomeScreen } from "./screens/HomeScreen";
import { Text } from "@ds";
export function App() {
  return <Router routes={[{ path: "/home", render: () => <HomeScreen /> }, { path: "/about", render: () => <Text>About page</Text> }]} />;
}
`);
  const tc = await runCheck("typecheck", config, adapter, "prototypes/smoke");
  console.log(formatCheck(tc));
  const lint = await runCheck("lint", config, adapter, "prototypes/smoke");
  console.log(formatCheck(lint));

  // A deliberate error must be caught and attributed to the prototype.
  fs.writeFileSync(path.join(dir, "screens/Broken.tsx"), `import { Button } from "@ds";\nexport const Broken = () => <Button variant="huge">x</Button>;\n`);
  const bad = await runCheck("typecheck", config, adapter, "prototypes/smoke");
  console.log("broken passed?", bad.passed, "\n" + formatCheck(bad));
  fs.rmSync(path.join(dir, "screens/Broken.tsx"));

  const dev = new DevServerManager();
  const port = await findFreePort(5180);
  const info = await dev.start(resolveCommand("dev_server", config.commands, { protoDir: "prototypes/smoke", port }), ws, "smoke", port, adapter.devServerReadyPattern);
  console.log("dev server:", info.url);
  const html = await (await fetch(info.url)).text();
  console.log("index served:", html.includes('<div id="root">'));
  const main = await (await fetch(`${info.url}main.tsx`)).text();
  console.log("main.tsx transformed:", main.includes("createRoot"));
  const ds = await fetch(`${info.url}screens/HomeScreen.tsx`).then((r) => r.text());
  console.log("@ds alias resolved:", /src\/components\/index\.ts/.test(ds));
  dev.stop();

  const mcp = new McpManager(config, () => buildCatalogue(config), (m) => console.log("  log:", m));
  const statuses = await mcp.connectAll();
  for (const s of statuses) console.log(`[${s.name}] ${s.state}: ${s.note}`);
  console.log("tools:", mcp.toolDefinitions().map((t) => t.name).join(", "));
  const r = await mcp.call("catalogue__get_component", { name: "Switch" });
  console.log("get_component:", JSON.stringify(r).slice(0, 200));
  await mcp.closeAll();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("smoke: OK");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
