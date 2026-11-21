/**
 * Headless runner: drives the same agent core the extension uses, from the
 * terminal. Plans are auto-approved and questions get their first option.
 *
 *   npm run e2e -- --brief "a settings page with a profile form and a notifications tab"
 *   npm run e2e -- --prototype settings --feedback "add an empty state to notifications"
 *
 * Credentials: the Anthropic SDK's default chain (ANTHROPIC_API_KEY, or a
 * profile from `ant auth login`). The key is never written anywhere.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { defaultConfig, type Effort } from "../src/core/config";
import { createHarness } from "../src/core/harness";
import type { HarnessHost } from "../src/core/host";
import type { HarnessEvent } from "../src/core/protocol";

const { values } = parseArgs({
  options: {
    workspace: { type: "string", default: "sample-workspace" },
    brief: { type: "string" },
    feedback: { type: "string", multiple: true },
    prototype: { type: "string" },
    figma: { type: "string" },
    model: { type: "string" },
    effort: { type: "string" },
    "no-playwright": { type: "boolean", default: false },
    "no-figma": { type: "boolean", default: false },
    "keep-server": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

const workspace = path.resolve(values.workspace!);
const config = defaultConfig(workspace);
if (values.model) config.model = values.model;
if (values.effort) config.effort = values.effort as Effort;
if (values["no-playwright"]) config.mcp.playwright.enabled = false;
if (values["no-figma"]) config.mcp.figma.enabled = false;

const runDir = path.join(workspace, ".uiux-harness", "runs");
fs.mkdirSync(runDir, { recursive: true });
const logFile = path.join(runDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
const log = fs.createWriteStream(logFile);
const c = { dim: "\x1b[2m", reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m" };
let midText = false;

function print(event: HarnessEvent): void {
  log.write(`${JSON.stringify({ t: Date.now(), ...event, ...(event.type === "file_written" ? { diff: undefined } : {}) })}\n`);
  const endText = () => {
    if (midText) process.stdout.write("\n");
    midText = false;
  };
  switch (event.type) {
    case "assistant_delta":
      process.stdout.write(event.text);
      midText = true;
      break;
    case "assistant_done":
      endText();
      break;
    case "activity": {
      if (event.item.status === "running") break;
      endText();
      const mark = event.item.status === "done" ? `${c.green}✓` : `${c.red}✗`;
      const secs = event.item.endedAt ? ((event.item.endedAt - event.item.startedAt) / 1000).toFixed(1) : "";
      console.log(`${mark} ${event.item.label}${c.reset}${c.dim} ${secs}s${values.verbose && event.item.detail ? ` [${event.item.detail}]` : ""}${c.reset}`);
      break;
    }
    case "question":
      endText();
      console.log(`${c.cyan}? ${event.question}${c.reset}`);
      if (event.plan) {
        const p = event.plan;
        console.log(`${c.bold}  Plan: ${p.title}${c.reset} (${p.prototypeName}): ${p.summary}`);
        for (const s of p.screens) console.log(`   • ${s.name} ${c.dim}${s.route}${c.reset}: ${s.components.join(", ")}`);
        for (const f of p.flow) console.log(`   → ${f.from} → ${f.action} → ${f.to}`);
        for (const m of p.missingComponents) console.log(`   ${c.yellow}missing:${c.reset} ${m.need} (using ${m.usingInstead})`);
        for (const a of p.assumptions) console.log(`   ${c.dim}assumes: ${a}${c.reset}`);
      } else if (event.options.length) {
        console.log(`  options: ${event.options.join(" | ")}`);
      }
      break;
    case "connections":
      for (const i of event.items) console.log(`${c.dim}[${i.name}] ${i.state}: ${i.note}${c.reset}`);
      break;
    case "notice":
      endText();
      console.log(`${event.level === "error" ? c.red : c.yellow}! ${event.message}${c.reset}`);
      break;
    case "preview":
      console.log(`${c.cyan}⧉ preview: ${event.url}${c.reset}`);
      break;
    case "file_written":
      if (values.verbose) console.log(`${c.dim}  wrote ${event.path}${c.reset}`);
      break;
    case "run_finished":
      endText();
      console.log(`${c.bold}— run ${event.outcome}${c.reset}`);
      break;
    default:
      break;
  }
}

const host: HarnessHost = {
  emit: print,
  async askUser(req) {
    if (req.plan) {
      console.log(`${c.green}  (auto-approved)${c.reset}`);
      return { answer: "Build it", approved: true };
    }
    const answer = req.options[0] ?? "Use your best judgement and note it as an assumption.";
    console.log(`${c.green}  (auto-answer) ${answer}${c.reset}`);
    return { answer };
  },
  async getDiagnostics() {
    return undefined; // no editor here: the tool falls back to the type checker
  },
  preview: {
    async open(url) {
      console.log(`${c.cyan}⧉ preview open ${url}${c.reset}`);
    },
    async navigate(url) {
      console.log(`${c.cyan}⧉ preview → ${url}${c.reset}`);
    },
    async reload() {
      console.log(`${c.cyan}⧉ preview reload${c.reset}`);
    },
  },
  log(message) {
    log.write(`${JSON.stringify({ t: Date.now(), type: "log", message })}\n`);
    if (values.verbose) console.log(`${c.dim}${message}${c.reset}`);
  },
};

async function main(): Promise<number> {
  if (!values.brief && !values.prototype) {
    console.error('Usage: npm run e2e -- --brief "..." [--feedback "..."] | --prototype <name> --feedback "..."');
    return 2;
  }
  console.log(`${c.dim}workspace ${workspace} · model ${config.model} · effort ${config.effort} · log ${path.relative(process.cwd(), logFile)}${c.reset}`);
  const harness = await createHarness({ config, host, skillsDir: path.resolve(__dirname, "../skills") });
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let failed = false;
  try {
    if (values.prototype) harness.session.loadPrototype(values.prototype);
    const requests = [...(values.brief ? [values.brief] : []), ...(values.feedback ?? [])];
    for (const text of requests) {
      console.log(`\n${c.bold}» ${text}${c.reset}`);
      const result = await harness.session.send(text, { figmaUrl: values.figma });
      for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += result.usage[k];
      console.log(`${c.dim}turns ${result.turns} · tokens in ${result.usage.input} (+cache read ${result.usage.cacheRead}, write ${result.usage.cacheWrite}) out ${result.usage.output}${c.reset}`);
      if (result.outcome !== "done") failed = true;
    }
    console.log(`\nprototype: ${harness.session.state.protoRelDir ?? "(none)"}`);
    console.log(`${c.dim}total tokens: in ${totals.input}, cache read ${totals.cacheRead}, cache write ${totals.cacheWrite}, out ${totals.output}${c.reset}`);
    if (values["keep-server"] && harness.devServer.current) {
      console.log(`Dev server still running at ${harness.devServer.current.url}. Press Ctrl+C to stop.`);
      await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
    }
  } finally {
    await harness.dispose();
    log.end();
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
