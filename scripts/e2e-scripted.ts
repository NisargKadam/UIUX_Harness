/**
 * Scripted end-to-end run: the real AgentSession, real tools, path guard,
 * quality gates, dev server and MCP connections (catalogue + Playwright), with
 * the *model* replaced by a script that replays the tool calls a good run makes
 * for the brief "a settings page with a profile form and a notifications tab".
 *
 * What this proves: the harness machinery works end to end without an API key.
 * It does not test the model's judgment. That needs `npm run e2e` with a key.
 *
 * The script also probes the guard rails on the way:
 *   - writing before the plan is approved is refused
 *   - writing outside the prototype, or into a reserved config file, is refused
 *   - a type error makes the quality gate send the model back to fix it
 *   - with Playwright connected, the gate asks for a self-review before finishing
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { defaultConfig } from "../src/core/config";
import { createHarness } from "../src/core/harness";
import type { HarnessHost } from "../src/core/host";
import type { HarnessEvent } from "../src/core/protocol";

type Params = Anthropic.Beta.MessageCreateParamsStreaming;
type ToolCall = { name: string; input: Record<string, unknown> };
interface TurnCtx {
  lastResults: Array<{ tool_use_id: string; content: unknown; is_error?: boolean }>;
  lastUserText: string;
  devUrl?: string;
}
type Turn = (ctx: TurnCtx) => { text?: string; tools?: ToolCall[] };

const ROOT = path.resolve(__dirname, "..");
const WS = path.join(ROOT, "sample-workspace");
const FIXTURE = path.join(ROOT, "test/fixtures/settings-prototype");
const BRIEF = "a settings page with a profile form and a notifications tab";
const P = "prototypes/settings";
const fixture = (rel: string) => fs.readFileSync(path.join(FIXTURE, rel), "utf8");

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
const expect = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail && !ok ? ` (${detail})` : ""}`);
};
const resultText = (r: { content: unknown }) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content));

let snapshotRefs: Record<string, string> = {};
function refFor(label: string): string {
  const ref = snapshotRefs[label];
  if (!ref) throw new Error(`No ref for "${label}" in the last snapshot`);
  return ref;
}

const plan = {
  prototypeName: "settings",
  title: "Account settings",
  summary: "A settings page with two tabs: a profile form you can edit and save, and notification switches that apply instantly.",
  screens: [
    { id: "profile", name: "Profile", route: "/settings/profile", purpose: "Edit name, email, role, time zone and bio, then save", components: ["Tabs", "Card", "Avatar", "TextField", "Select", "Button", "Alert"] },
    { id: "notifications", name: "Notifications", route: "/settings/notifications", purpose: "Turn email and push notifications on or off", components: ["Tabs", "Card", "Switch", "Text"] },
  ],
  flow: [
    { from: "Profile", action: "clicks the Notifications tab", to: "Notifications" },
    { from: "Notifications", action: "clicks the Profile tab", to: "Profile" },
    { from: "Profile", action: "edits a field and clicks Save changes", to: "Profile with success message" },
  ],
  missingComponents: [{ need: "Avatar uploader", usingInstead: "Avatar + secondary Button", reason: "Avatar is display-only and there is no file input component", screens: ["Profile"] }],
  assumptions: ["/settings opens the Profile tab", "Notification switches apply instantly (no Save button)"],
};

const turns: Turn[] = [
  // 1. Try to write before any plan exists → must be refused.
  () => ({ tools: [{ name: "write_file", input: { path: `${P}/App.tsx`, content: "export function App() { return null; }" } }] }),
  (ctx) => {
    expect("write before plan approval is refused", ctx.lastResults[0]?.is_error === true && /No prototype is active/.test(resultText(ctx.lastResults[0]!)));
    return { tools: [{ name: "catalogue__list_components", input: {} }] };
  },
  // 2. Present the plan.
  (ctx) => {
    expect("catalogue lists components", /\\?"name\\?": ?\\?"Tabs\\?"/.test(resultText(ctx.lastResults[0]!)), resultText(ctx.lastResults[0]!).slice(0, 200));
    return { text: "Here's my plan.", tools: [{ name: "ask_user", input: { question: "Shall I build this?", plan } }] };
  },
  // 3. Probe the guard rails (parallel calls in one turn).
  (ctx) => {
    expect("plan approval activates the prototype", /approved the plan/.test(resultText(ctx.lastResults[0]!)));
    return {
      tools: [
        { name: "write_file", input: { path: "src/components/Badge.tsx", content: "export const Badge = () => null;" } },
        { name: "write_file", input: { path: `${P}/vite.config.mjs`, content: "export default {}" } },
        { name: "write_file", input: { path: `${P}/../other/App.tsx`, content: "x" } },
        { name: "run_command", input: { command: "npm install left-pad" } },
      ],
    };
  },
  // 4. Build the prototype (ProfileTab still contains a deliberate type error).
  (ctx) => {
    const [outside, config, escape, cmd] = ctx.lastResults;
    expect("write outside the prototype is refused", outside?.is_error === true && /only write inside prototypes\/settings/.test(resultText(outside!)));
    expect("write to vite.config.mjs is refused", config?.is_error === true && /managed by the harness/.test(resultText(config!)));
    expect("../ escape is refused", escape?.is_error === true);
    expect("free-form command is refused", cmd?.is_error === true && /Invalid input/.test(resultText(cmd!)));
    return {
      tools: [
        { name: "write_file", input: { path: `${P}/mock/data.ts`, content: fixture("mock/data.ts"), activity: "Preparing sample data" } },
        { name: "write_file", input: { path: `${P}/parts/ProfileTab.tsx`, content: fixture("parts/ProfileTab.tsx") } },
        { name: "write_file", input: { path: `${P}/parts/NotificationsTab.tsx`, content: fixture("parts/NotificationsTab.tsx") } },
        { name: "write_file", input: { path: `${P}/screens/SettingsScreen.tsx`, content: fixture("screens/SettingsScreen.tsx") } },
        { name: "write_file", input: { path: `${P}/prototype.css`, content: fixture("prototype.css") } },
        { name: "write_file", input: { path: `${P}/App.tsx`, content: fixture("App.tsx") } },
      ],
    };
  },
  (ctx) => {
    expect("all six prototype files written", ctx.lastResults.length === 6 && ctx.lastResults.every((r) => !r.is_error));
    return { tools: [{ name: "run_command", input: { command: "dev_server" } }] };
  },
  (ctx) => {
    expect("dev server starts", /Dev server running at http/.test(resultText(ctx.lastResults[0]!)), resultText(ctx.lastResults[0]!));
    return { tools: [{ name: "preview", input: { action: "open", route: "/settings/profile" } }] };
  },
  // 5. Claim to be done → the gate must catch the type error.
  () => ({ text: "All done!" }),
  (ctx) => {
    expect("quality gate catches the type error and asks for a fix", /fix attempt 1 of 3/.test(ctx.lastUserText) && /tertiary/.test(ctx.lastUserText), ctx.lastUserText.slice(0, 300));
    return { tools: [{ name: "write_file", input: { path: `${P}/parts/ProfileTab.tsx`, edits: [{ find: 'variant="tertiary"', replace: 'variant="primary"' }] } }] };
  },
  (ctx) => {
    expect("fix applied with edits", /Updated/.test(resultText(ctx.lastResults[0]!)));
    return { tools: [{ name: "run_command", input: { command: "typecheck" } }] };
  },
  (ctx) => {
    expect("type check passes after the fix", /Type check: passed/.test(resultText(ctx.lastResults[0]!)), resultText(ctx.lastResults[0]!));
    return { text: "Fixed. Finishing up." };
  },
  // 6. With Playwright connected, the gate requests self-review.
  (ctx) => {
    const nudged = /self-review skill/.test(ctx.lastUserText);
    expect("gate asks for a self-review in the browser", nudged, ctx.lastUserText.slice(0, 200));
    return { tools: [{ name: "playwright__browser_navigate", input: { url: ctx.devUrl } }] };
  },
  () => ({ tools: [{ name: "playwright__browser_snapshot", input: {} }] }),
  (ctx) => {
    const snap = resultText(ctx.lastResults[0]!);
    snapshotRefs = {};
    for (const m of snap.matchAll(/tab \\?"([^"\\]+)\\?"[^\n]*?\[ref=([a-z0-9]+)\]/g)) snapshotRefs[m[1]!] = m[2]!;
    expect("root URL redirects to the Profile tab and shows the heading and both tabs", /#\/settings\/profile/.test(snap) && /heading \\?"Settings\\?"/.test(snap) && "Profile" in snapshotRefs && "Notifications" in snapshotRefs, snap.slice(0, 400));
    return { tools: [{ name: "playwright__browser_click", input: { target: refFor("Notifications"), element: "Notifications tab" } }] };
  },
  () => ({ tools: [{ name: "playwright__browser_snapshot", input: {} }] }),
  (ctx) => {
    const snap = resultText(ctx.lastResults[0]!);
    expect("clicking Notifications navigates to #/settings/notifications", /#\/settings\/notifications/.test(snap) && /Weekly digest/.test(snap), snap.slice(0, 400));
    return { tools: [{ name: "playwright__browser_take_screenshot", input: {} }] };
  },
  (ctx) => {
    const r = ctx.lastResults[0]!;
    expect("screenshot returned as an image block", Array.isArray(r.content) && (r.content as Array<{ type: string }>).some((b) => b.type === "image"));
    return { tools: [{ name: "playwright__browser_console_messages", input: {} }] };
  },
  () => ({
    text: "- Built a Settings page with Profile and Notifications tabs, each with its own link.\n- I clicked through both tabs and fixed one problem during checks.\n- Still off: photo upload is a placeholder (no uploader in the library).",
  }),
];

/** A stand-in for client.beta.messages: replays `turns`, recording every request. */
function scriptedClient(getDevUrl: () => string | undefined): { client: Anthropic; requests: Params[] } {
  const requests: Params[] = [];
  let i = 0;
  let toolId = 0;
  const stream = (params: Params) => {
    requests.push(structuredClone(params));
    const last = params.messages[params.messages.length - 1];
    const blocks = last && Array.isArray(last.content) ? (last.content as Array<{ type: string; text?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }>) : [];
    const ctx: TurnCtx = {
      lastResults: blocks.filter((b) => b.type === "tool_result") as TurnCtx["lastResults"],
      lastUserText: blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
      devUrl: getDevUrl(),
    };
    const turn = turns[i++];
    const out = turn ? turn(ctx) : { text: "(script exhausted)" };
    const content: Anthropic.Beta.BetaContentBlock[] = [];
    if (out.text) content.push({ type: "text", text: out.text, citations: null } as Anthropic.Beta.BetaTextBlock);
    for (const t of out.tools ?? []) content.push({ type: "tool_use", id: `toolu_${++toolId}`, name: t.name, input: t.input } as Anthropic.Beta.BetaToolUseBlock);
    const message = {
      id: `msg_${i}`,
      type: "message",
      role: "assistant",
      model: params.model,
      content,
      stop_reason: out.tools?.length ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as unknown as Anthropic.Beta.BetaMessage;
    const listeners: Array<(t: string) => void> = [];
    return {
      on(event: string, cb: (t: string) => void) {
        if (event === "text") listeners.push(cb);
        return this;
      },
      async finalMessage() {
        if (out.text) for (const l of listeners) l(out.text);
        return message;
      },
    };
  };
  const client = { beta: { messages: { stream } } } as unknown as Anthropic;
  return { client, requests };
}

async function main(): Promise<number> {
  fs.rmSync(path.join(WS, P), { recursive: true, force: true });
  const config = defaultConfig(WS);
  config.mcp.figma.enabled = false;
  const events: HarnessEvent[] = [];
  const host: HarnessHost = {
    emit: (e) => {
      events.push(e);
      if (e.type === "activity" && e.item.status !== "running") console.log(`   ${e.item.status === "done" ? "·" : "×"} ${e.item.label}`);
    },
    askUser: async (req) => (req.plan ? { answer: "Build it", approved: true } : { answer: req.options[0] ?? "ok" }),
    getDiagnostics: async () => undefined,
    preview: { open: async () => {}, navigate: async () => {}, reload: async () => {} },
    log: () => {},
  };
  const harness = await createHarness({ config, host, skillsDir: path.join(ROOT, "skills") });
  const { client, requests } = scriptedClient(() => harness.devServer.current?.url);
  // Swap the real client for the script (the session reads deps.client on every call).
  (harness.session as unknown as { deps: { client: Anthropic } }).deps.client = client;
  console.log(`connections: ${harness.connections.map((c) => `${c.name}=${c.state}`).join(", ")}`);
  if (!harness.mcp.isConnected("playwright")) {
    console.log("Playwright MCP is not connected; this script needs it for the self-review steps.");
    await harness.dispose();
    return 1;
  }

  let exitCode = 0;
  try {
    const result = await harness.session.send(BRIEF);
    expect("run finished with outcome 'done'", result.outcome === "done", result.outcome);

    // Request shape the real API would receive.
    const first = requests[0]!;
    const systemText = (Array.isArray(first.system) ? first.system : []).map((b) => (b as { text: string }).text).join("\n");
    const toolNames = (first.tools ?? []).map((t) => (t as { name: string }).name);
    expect("model id comes from config", first.model === config.model);
    expect("six built-in tools offered", ["read_file", "write_file", "run_command", "get_diagnostics", "preview", "ask_user"].every((n) => toolNames.includes(n)));
    expect("MCP tools namespaced and filtered", toolNames.some((n) => n.startsWith("catalogue__")) && toolNames.includes("playwright__browser_click") && !toolNames.includes("playwright__browser_run_code_unsafe"));
    expect("all four skills are in the system prompt", ["brief-interpretation", "component-mapping", "prototype-scaffolding", "self-review"].every((s) => systemText.includes(`<skill name="${s}">`)));
    expect("prompt caching and effort are set", JSON.stringify(first.cache_control) === '{"type":"ephemeral"}' && first.output_config?.effort === config.effort);
    expect("refusal fallback is requested", first.fallbacks === "default" && (first.betas ?? []).includes("server-side-fallback-2026-07-01"));
    expect("every client tool streams input eagerly", (first.tools ?? []).every((t) => (t as { eager_input_streaming?: boolean }).eager_input_streaming === true));
    const tools = JSON.stringify(first.tools);
    expect("no secrets in requests", !/sk-ant-/.test(tools + JSON.stringify(first.system)));

    // History integrity: every tool_use has a tool_result in the next message.
    const lastReq = requests[requests.length - 1]!;
    let dangling = 0;
    lastReq.messages.forEach((m, idx) => {
      if (m.role !== "assistant" || !Array.isArray(m.content)) return;
      const ids = (m.content as Array<{ type: string; id?: string }>).filter((b) => b.type === "tool_use").map((b) => b.id);
      const next = lastReq.messages[idx + 1];
      const got = next && Array.isArray(next.content) ? (next.content as Array<{ type: string; tool_use_id?: string }>).filter((b) => b.type === "tool_result").map((b) => b.tool_use_id) : [];
      dangling += ids.filter((id) => !got.includes(id)).length;
    });
    expect("conversation history is valid (no dangling tool_use)", dangling === 0, `${dangling} dangling`);

    const kinds = new Set(events.map((e) => e.type));
    expect("UI events emitted (plan, missing components, preview, file diffs)", ["question", "plan_approved", "missing_components", "preview", "file_written"].every((k) => kinds.has(k as HarnessEvent["type"])));
    const labels = events.filter((e) => e.type === "activity").map((e) => (e as Extract<HarnessEvent, { type: "activity" }>).item.label);
    expect("activity labels are in designer language", labels.includes("Building the Settings screen") && labels.includes("Wiring up navigation between screens") && labels.some((l) => l.startsWith("Clicking")), labels.join(" | "));
    expect("MISSING_COMPONENTS.md written", fs.readFileSync(path.join(WS, P, "MISSING_COMPONENTS.md"), "utf8").includes("Avatar uploader"));
    expect("state saved for follow-ups", JSON.parse(fs.readFileSync(path.join(WS, P, ".harness/state.json"), "utf8")).brief === BRIEF);
    expect("no files written outside the prototype", !fs.existsSync(path.join(WS, "src/components/Badge.tsx")) && !fs.existsSync(path.join(WS, "prototypes/other")));
    console.log(`\nmodel calls: ${requests.length}, prototype: ${harness.session.state.protoRelDir}, dev server: ${harness.devServer.current?.url}`);
  } finally {
    await harness.dispose();
    harness.devServer.stop();
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) exitCode = 1;
  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
