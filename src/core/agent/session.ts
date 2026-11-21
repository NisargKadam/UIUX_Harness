/**
 * The agent loop: a streaming loop on the Messages API (see docs/adr/0001-agent-loop.md).
 *
 * Per model call:
 *  - stream text deltas to the UI
 *  - append the full response.content (history is append-only, which preserved thinking needs)
 *  - run the requested tools (validated, guarded, labelled for the designer) and
 *    return every tool_result in a single user message
 *
 * When the model says it is done, the loop applies code-enforced quality gates:
 *  1. type check + lint must pass for prototype files (bounded by maxFixAttempts)
 *  2. the dev server is running and the preview shows the prototype
 *  3. if a review browser is connected, the latest version has been looked at
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { activityLabel } from "../activity";
import type { FrameworkAdapter } from "../adapters/types";
import type { HarnessConfig } from "../config";
import { findFigmaUrl, parseFigmaUrl } from "../figma";
import type { HarnessHost } from "../host";
import type { McpManager } from "../mcp/manager";
import { CommandPolicyError, resolveCommand } from "../policy/commandPolicy";
import { PathGuardError } from "../policy/pathGuard";
import { findFreePort, type DevServerManager } from "../process/runner";
import type { ActivityItem } from "../protocol";
import { builtinToolDefinitions, findBuiltin, type ToolContext, type ToolOutput } from "../tools/builtin";
import { formatCheck, runCheck } from "../tools/checks";
import { SessionState } from "./state";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;
type ToolUse = Anthropic.Beta.BetaToolUseBlock;

export interface AgentSessionDeps {
  client: Anthropic;
  config: HarnessConfig;
  host: HarnessHost;
  adapter: FrameworkAdapter;
  mcp: McpManager;
  devServer: DevServerManager;
  system: Anthropic.Beta.BetaTextBlockParam[];
}

export interface RunOutcome {
  outcome: "done" | "stopped" | "failed" | "limit";
  summary: string;
  turns: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

const MAX_TOKENS = 64_000;
const MAX_STREAM_RETRIES = 2;

export class AgentSession {
  readonly state: SessionState;
  private readonly messages: MessageParam[] = [];
  private controller: AbortController | undefined;
  private activitySeq = 0;
  private loadedContextSent = false;

  constructor(private readonly deps: AgentSessionDeps) {
    this.state = new SessionState(deps.config, deps.adapter);
  }

  get isRunning(): boolean {
    return this.controller !== undefined;
  }

  /** Continue an existing prototype in a fresh session. */
  loadPrototype(name: string): void {
    this.state.load(name);
    this.loadedContextSent = false;
  }

  stop(): void {
    if (this.controller) {
      this.deps.host.emit({ type: "run_state", state: "stopping" });
      this.controller.abort();
    }
  }

  private tools(): Anthropic.Beta.BetaToolUnion[] {
    return [...builtinToolDefinitions(), ...this.deps.mcp.toolDefinitions()];
  }

  private activity(label: string, detail?: string): { done: (ok?: boolean, detail?: string) => void } {
    const item: ActivityItem = { id: `a${++this.activitySeq}`, label, status: "running", detail, startedAt: Date.now() };
    this.deps.host.emit({ type: "activity", item: { ...item } });
    return {
      done: (ok = true, d?: string) => {
        item.status = ok ? "done" : "failed";
        item.endedAt = Date.now();
        if (d) item.detail = d;
        this.deps.host.emit({ type: "activity", item: { ...item } });
      },
    };
  }

  /** Build the user turn: the designer's words plus harness context (prototype, Figma). */
  private composeUserTurn(text: string, figmaUrl?: string): string {
    const parts: string[] = [];
    const figma = figmaUrl ? parseFigmaUrl(figmaUrl) : findFigmaUrl(text);
    const st = this.state;
    if (st.prototype) {
      if (!this.loadedContextSent) {
        this.loadedContextSent = true;
        const rec = st.record;
        parts.push(
          `[Harness context] Continuing the existing prototype ${st.protoRelDir}/. Files: ${st.listFiles().join(", ") || "(none)"}.` +
            (rec?.plan ? `\nApproved plan: ${JSON.stringify(rec.plan)}` : "") +
            (rec?.brief ? `\nOriginal brief: ${rec.brief}` : ""),
        );
      } else {
        parts.push(`[Harness context] Active prototype: ${st.protoRelDir}/.`);
      }
      parts.push(`Designer's feedback:\n${text}`);
    } else {
      st.pendingBrief = text;
      st.pendingFigmaUrl = figma?.url;
      parts.push(`Designer's brief:\n${text}`);
    }
    if (figma) {
      const figmaState = this.deps.mcp.isConnected("figma") ? "connected" : "NOT connected";
      parts.push(
        `[Harness context] Figma frame linked: ${figma.url} (fileKey: ${figma.fileKey}${figma.nodeId ? `, nodeId: ${figma.nodeId}` : ""}). Figma MCP is ${figmaState}.`,
      );
    }
    return parts.join("\n\n");
  }

  async send(text: string, opts: { figmaUrl?: string } = {}): Promise<RunOutcome> {
    if (this.controller) throw new Error("A run is already in progress.");
    const controller = new AbortController();
    this.controller = controller;
    const { host, config } = this.deps;
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let turns = 0;
    let fixAttempts = 0;
    let reviewNudged = false;
    let lastText = "";
    let phase: { done: (ok?: boolean) => void } | undefined;

    const finish = (outcome: RunOutcome["outcome"], summary = lastText): RunOutcome => {
      phase?.done(outcome === "done");
      try {
        this.state.saveRecord();
      } catch (err) {
        host.log(`could not save prototype state: ${(err as Error).message}`);
      }
      host.emit({ type: "run_finished", outcome, summary });
      host.emit({ type: "run_state", state: "idle", prototype: this.state.prototype });
      return { outcome, summary, turns, usage };
    };

    // Everything after `this.controller` is set runs inside try/finally, so a
    // failure here can never leave the session stuck in "running".
    try {
      this.state.startRequest();
      this.state.record?.feedback.push(text);
      host.emit({ type: "run_state", state: "running", prototype: this.state.prototype });
      phase = this.activity(this.state.prototype ? "Working on your feedback" : "Reading your brief");
      this.messages.push({ role: "user", content: [{ type: "text", text: this.composeUserTurn(text, opts.figmaUrl) }] });

      for (;;) {
        if (controller.signal.aborted) return finish("stopped");
        if (turns >= config.limits.maxTurns) {
          host.emit({ type: "notice", level: "warning", message: `I stopped after ${config.limits.maxTurns} steps. That's the safety limit for one request.` });
          return finish("limit");
        }
        turns++;
        const message = await this.callModel(controller.signal, usage);
        this.messages.push({ role: "assistant", content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
        const textNow = message.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        if (textNow) lastText = textNow;

        if (message.stop_reason === "refusal") {
          host.emit({ type: "notice", level: "error", message: "The model declined this request. Try rephrasing the brief." });
          return finish("failed");
        }
        const toolUses = message.content.filter((b): b is ToolUse => b.type === "tool_use");

        if (message.stop_reason === "pause_turn") continue;

        if (message.stop_reason === "max_tokens") {
          if (toolUses.length > 0) {
            // Never run a tool on input cut off mid-stream; tell the model instead.
            this.messages.push({
              role: "user",
              content: toolUses.map((t) => ({
                type: "tool_result",
                tool_use_id: t.id,
                is_error: true,
                content: "Your output was cut off (max_tokens) before this call was complete, so it did not run. Split large files or use `edits`.",
              })),
            });
          } else {
            this.messages.push({ role: "user", content: [{ type: "text", text: "[Harness] Your reply was cut off. Continue from where you stopped." }] });
          }
          continue;
        }

        if (toolUses.length > 0) {
          const results = await this.runTools(toolUses, controller.signal);
          this.messages.push({ role: "user", content: results });
          continue;
        }

        // The model considers itself done: quality gates.
        const gate = await this.qualityGate(controller.signal, fixAttempts, reviewNudged);
        if (gate.kind === "retry") {
          fixAttempts++;
          this.messages.push({ role: "user", content: [{ type: "text", text: gate.message }] });
          continue;
        }
        if (gate.kind === "review") {
          reviewNudged = true;
          this.messages.push({ role: "user", content: [{ type: "text", text: gate.message }] });
          continue;
        }
        if (gate.kind === "exhausted") {
          host.emit({ type: "notice", level: "warning", message: gate.message });
          return finish("limit");
        }
        return finish("done");
      }
    } catch (err) {
      if (controller.signal.aborted || err instanceof Anthropic.APIUserAbortError) return finish("stopped");
      host.emit({ type: "notice", level: "error", message: describeError(err) });
      host.log(`run failed: ${(err as Error).stack ?? String(err)}`);
      return finish("failed");
    } finally {
      this.closeDanglingToolUses();
      this.controller = undefined;
    }
  }

  private async callModel(signal: AbortSignal, usage: RunOutcome["usage"]): Promise<Anthropic.Beta.BetaMessage> {
    const { client, config, host, system } = this.deps;
    let attempt = 0;
    for (;;) {
      const stream = client.beta.messages.stream(
        {
          model: config.model,
          max_tokens: MAX_TOKENS,
          system,
          tools: this.tools(),
          messages: this.messages,
          output_config: { effort: config.effort },
          cache_control: { type: "ephemeral" },
          ...(config.refusalFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal },
      );
      stream.on("text", (delta) => host.emit({ type: "assistant_delta", text: delta }));
      try {
        const message = await stream.finalMessage();
        host.emit({ type: "assistant_done" });
        usage.input += message.usage.input_tokens;
        usage.output += message.usage.output_tokens;
        usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
        usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
        return message;
      } catch (err) {
        host.emit({ type: "assistant_done" });
        // API errors (auth, 400, rate limits after SDK retries) and aborts are final.
        // Dropped connections and unparseable streamed tool input are retried.
        if (err instanceof Anthropic.APIError || signal.aborted || attempt >= MAX_STREAM_RETRIES) throw err;
        attempt++;
        host.log(`stream failed (${(err as Error).message}); retrying ${attempt}/${MAX_STREAM_RETRIES}`);
      }
    }
  }

  private toolContext(signal: AbortSignal): ToolContext {
    const { config, adapter, host, devServer } = this.deps;
    return { config, adapter, host, devServer, state: this.state, signal };
  }

  private async runTools(toolUses: ToolUse[], signal: AbortSignal): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const use of toolUses) {
      if (signal.aborted) {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Stopped by the designer before this ran." });
        continue;
      }
      const input = (use.input && typeof use.input === "object" ? use.input : {}) as Record<string, unknown>;
      const act = this.activity(activityLabel(use.name, input), use.name);
      let output: ToolOutput;
      try {
        output = await this.executeTool(use.name, input, signal);
      } catch (err) {
        output = { content: toolErrorMessage(err), isError: true };
      }
      act.done(!output.isError);
      if (!output.isError && use.name.startsWith("playwright__") && /screenshot|snapshot/.test(use.name)) {
        this.state.lastReviewSeq = this.state.writeSeq;
      }
      results.push({ type: "tool_result", tool_use_id: use.id, content: output.content, is_error: output.isError || undefined });
    }
    return results;
  }

  private async executeTool(name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutput> {
    const builtin = findBuiltin(name);
    if (builtin) {
      const parsed = builtin.schema.safeParse(input);
      if (!parsed.success) {
        return { content: `Invalid input for ${name}: ${z.prettifyError(parsed.error)}`, isError: true };
      }
      return builtin.run(parsed.data, this.toolContext(signal));
    }
    if (this.deps.mcp.has(name)) {
      return this.deps.mcp.call(name, input, signal);
    }
    return { content: `Unknown tool "${name}".`, isError: true };
  }

  private async qualityGate(
    signal: AbortSignal,
    fixAttempts: number,
    reviewNudged: boolean,
  ): Promise<{ kind: "pass" } | { kind: "retry" | "review" | "exhausted"; message: string }> {
    const st = this.state;
    const { config, adapter, host, devServer, mcp } = this.deps;
    if (!st.prototype || st.filesWritten.size === 0) return { kind: "pass" };
    const protoRelDir = st.protoRelDir!;
    const max = config.limits.maxFixAttempts;

    const check = this.activity(fixAttempts > 0 ? "Double-checking the fixes" : "Double-checking the prototype for errors");
    const [tc, lint] = [await runCheck("typecheck", config, adapter, protoRelDir, signal), await runCheck("lint", config, adapter, protoRelDir, signal)];
    const passed = tc.passed && lint.passed;
    check.done(passed);
    if (!passed) {
      const problems = [tc, lint].filter((r) => !r.passed).map(formatCheck).join("\n\n");
      if (fixAttempts < max) {
        this.activity(`Fixing errors (attempt ${fixAttempts + 1} of ${max})`).done();
        return {
          kind: "retry",
          message: `[Harness check, fix attempt ${fixAttempts + 1} of ${max}] The prototype has problems that must be fixed before you finish:\n\n${problems}\n\nFix them in the prototype, re-run the checks, then give your final report.`,
        };
      }
      const count = tc.inPrototype.length + lint.inPrototype.filter((d) => d.severity === "error").length;
      return {
        kind: "exhausted",
        message: `I couldn't clear every code problem after ${max} attempts (${count} left). Parts of the prototype may not load. Tell me what you see in the preview and I'll keep going.`,
      };
    }
    st.lastCleanCheckSeq = st.writeSeq;

    // Make sure the designer is looking at the result, even if the model forgot.
    if (!devServer.current || devServer.current.prototype !== st.prototype) {
      const act = this.activity("Starting the live preview");
      try {
        const port = await findFreePort(5180);
        const cmd = resolveCommand("dev_server", config.commands, { protoDir: protoRelDir, port });
        const info = await devServer.start(cmd, config.workspaceRoot, st.prototype, port, adapter.devServerReadyPattern);
        await host.preview.open(info.url);
        host.emit({ type: "preview", url: info.url });
        act.done();
      } catch (err) {
        act.done(false, (err as Error).message);
        host.emit({ type: "notice", level: "warning", message: "The live preview didn't start. The prototype passes its checks, so try “Open prototype preview” again." });
      }
    }

    if (mcp.isConnected("playwright") && st.lastReviewSeq < st.writeSeq && !reviewNudged && config.limits.maxReviewRounds > 0) {
      const url = devServer.current?.url ?? "(dev server)";
      return {
        kind: "review",
        message: `[Harness check] Type check and lint pass. You have not looked at the latest version in the browser yet. Follow the self-review skill for what changed (dev server: ${url}): screenshot each affected screen, walk the click paths, compare against the Figma frame if there is one, and fix what is off (at most ${config.limits.maxReviewRounds} rounds). Then give your final report.`,
      };
    }
    return { kind: "pass" };
  }

  /**
   * If a run stops between an assistant tool_use and its results, add error
   * results so the conversation stays valid for the next request. This only
   * appends, never edits.
   */
  private closeDanglingToolUses(): void {
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== "assistant" || typeof last.content === "string") return;
    const uses = last.content.filter((b) => b.type === "tool_use") as Array<{ id: string }>;
    if (uses.length === 0) return;
    this.messages.push({
      role: "user",
      content: uses.map((u) => ({ type: "tool_result" as const, tool_use_id: u.id, is_error: true, content: "Stopped by the designer before this ran." })),
    });
  }
}

function toolErrorMessage(err: unknown): string {
  if (err instanceof PathGuardError || err instanceof CommandPolicyError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Run “UIUX Harness: Set Anthropic API key”.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use the selected model. Check the uiuxHarness.model setting.";
  if (err instanceof Anthropic.NotFoundError) return "The selected model wasn't found. Check the uiuxHarness.model setting.";
  if (err instanceof Anthropic.RateLimitError) return "The API is rate-limiting us right now. Wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) return `The API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `The API returned an error (${err.status ?? "?"}): ${err.message}`;
  return `Something went wrong: ${(err as Error).message ?? String(err)}`;
}
