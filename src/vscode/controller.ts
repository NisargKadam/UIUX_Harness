/**
 * Controller: owns the harness lifecycle in the extension, implements
 * HarnessHost on top of VS Code, and routes messages between the chat view,
 * the preview panel and the activity view.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Diagnostic } from "../core/adapters/types";
import { listPrototypes } from "../core/agent/state";
import type { Catalogue } from "../core/catalogue/types";
import { buildCatalogue, createHarness, type Harness } from "../core/harness";
import type { AskUserRequest, AskUserResponse, HarnessHost } from "../core/host";
import type { ChatToExtension, ConnectionStatus, HarnessEvent } from "../core/protocol";
import { resolveCommand } from "../core/policy/commandPolicy";
import { DevServerManager, findFreePort } from "../core/process/runner";
import type { ActivityView } from "./activityView";
import type { ChatView } from "./chatView";
import type { PreviewPanel } from "./previewPanel";
import type { ApiKeyStore } from "./secrets";
import { readConfig } from "./settings";

interface PendingQuestion {
  resolve: (r: AskUserResponse) => void;
  reject: (err: Error) => void;
}

const SHOW_CODE_KEY = "uiuxHarness.showCode";
const MAX_REPLAY = 2000;

export class Controller implements vscode.Disposable {
  private harness: Harness | undefined;
  private creating: Promise<Harness> | undefined;
  private readonly devServer = new DevServerManager();
  private catalogue: Catalogue | undefined;
  private readonly pending = new Map<string, PendingQuestion>();
  private transcript: HarnessEvent[] = [];
  private connections: ConnectionStatus[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly chat: ChatView,
    private readonly preview: PreviewPanel,
    private readonly activity: ActivityView,
    private readonly keys: ApiKeyStore,
    private readonly output: vscode.OutputChannel,
  ) {
    this.disposables.push(
      chat.onMessage((m) => void this.onChatMessage(m)),
      keys.onDidChange(() => {
        void this.resetHarness();
        void this.pushState();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("uiuxHarness")) {
          this.catalogue = undefined;
          void this.resetHarness();
          void this.pushState();
        }
      }),
    );
  }

  private get folder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  private get showCode(): boolean {
    return this.context.workspaceState.get<boolean>(SHOW_CODE_KEY, false);
  }

  // ------------------------------------------------------------------ host

  private readonly host: HarnessHost = {
    emit: (event) => this.onEvent(event),
    askUser: (req, signal) => this.ask(req, signal),
    getDiagnostics: (protoRelDir, signal) => this.collectDiagnostics(protoRelDir, signal),
    preview: {
      open: (url) => this.preview.show(url),
      navigate: (url) => this.preview.navigate(url),
      reload: () => this.preview.reload(),
    },
    log: (message) => this.output.appendLine(message),
  };

  private onEvent(event: HarnessEvent): void {
    switch (event.type) {
      case "activity":
        this.activity.upsert(event.item);
        break;
      case "run_state":
        this.activity.setRunState(event.state);
        void vscode.commands.executeCommand("setContext", "uiuxHarness.running", event.state !== "idle");
        if (event.state === "idle") void this.pushState();
        break;
      case "connections":
        this.connections = event.items;
        this.activity.setConnections(event.items);
        break;
      case "file_written":
        this.output.appendLine(`wrote ${event.path}`);
        break;
      case "notice":
        if (event.level === "error") this.output.appendLine(`error: ${event.message}`);
        break;
    }
    this.record(event);
    this.chat.post({ type: "event", event });
  }

  /** Keep a replayable transcript (deltas merged) so a reloaded chat view can be restored. */
  private record(event: HarnessEvent): void {
    const last = this.transcript[this.transcript.length - 1];
    if (event.type === "assistant_delta" && last?.type === "assistant_delta") {
      this.transcript[this.transcript.length - 1] = { type: "assistant_delta", text: last.text + event.text };
      return;
    }
    if (event.type === "activity") return; // the activity view holds these
    this.transcript.push(event);
    if (this.transcript.length > MAX_REPLAY) this.transcript.splice(0, this.transcript.length - MAX_REPLAY);
  }

  private ask(req: AskUserRequest, signal: AbortSignal): Promise<AskUserResponse> {
    this.activity.setRunState("waiting_for_user");
    void this.chat.reveal();
    return new Promise<AskUserResponse>((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(req.id);
        reject(new Error("Stopped"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(req.id, {
        resolve: (r) => {
          signal.removeEventListener("abort", onAbort);
          this.activity.setRunState("running");
          resolve(r);
        },
        reject,
      });
    });
  }

  /**
   * What VS Code's language extensions currently report for prototype files
   * (ESLint, CSS, and TypeScript for files open in an editor). VS Code's
   * TypeScript service only checks files visible in an editor, and the harness
   * keeps code out of the designer's way, so the get_diagnostics tool merges
   * this with a type-checker run over the whole prototype.
   */
  private async collectDiagnostics(protoRelDir: string, _signal: AbortSignal): Promise<Diagnostic[] | undefined> {
    const folder = this.folder;
    if (!folder) return undefined;
    const prefix = path.join(folder.uri.fsPath, protoRelDir) + path.sep;
    const out: Diagnostic[] = [];
    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      if (uri.scheme !== "file" || !uri.fsPath.startsWith(prefix)) continue;
      for (const d of diagnostics) {
        if (d.severity === vscode.DiagnosticSeverity.Hint) continue;
        out.push({
          file: path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/"),
          line: d.range.start.line + 1,
          column: d.range.start.character + 1,
          severity: d.severity === vscode.DiagnosticSeverity.Error ? "error" : d.severity === vscode.DiagnosticSeverity.Warning ? "warning" : "info",
          message: d.message,
          source: d.source ?? "vscode",
          code: typeof d.code === "object" ? String(d.code.value) : d.code !== undefined ? String(d.code) : undefined,
        });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ lifecycle

  private async ensureHarness(): Promise<Harness | undefined> {
    if (this.harness) return this.harness;
    if (this.creating) return this.creating;
    const folder = this.folder;
    if (!folder) {
      this.onEvent({ type: "notice", level: "error", message: "Open your project folder first (File → Open Folder…)." });
      return undefined;
    }
    let apiKey = await this.keys.get();
    if (!apiKey) {
      const saved = await this.keys.prompt();
      apiKey = saved ? await this.keys.get() : undefined;
      if (!apiKey) {
        this.onEvent({ type: "notice", level: "warning", message: "Add your Anthropic API key to start (UIUX Harness: Set Anthropic API key)." });
        return undefined;
      }
    }
    const config = readConfig(folder);
    this.creating = (async () => {
      const act = { id: "connect", label: "Connecting to Figma, your component library and the review browser", status: "running" as const, startedAt: Date.now() };
      this.activity.upsert(act);
      this.catalogue ??= buildCatalogue(config);
      try {
        const harness = await createHarness({
          config,
          host: this.host,
          skillsDir: vscode.Uri.joinPath(this.context.extensionUri, "skills").fsPath,
          apiKey,
          devServer: this.devServer,
          catalogue: this.catalogue,
        });
        this.activity.upsert({ ...act, status: "done", endedAt: Date.now() });
        this.harness = harness;
        return harness;
      } catch (err) {
        this.activity.upsert({ ...act, status: "failed", endedAt: Date.now() });
        throw err;
      } finally {
        this.creating = undefined;
      }
    })();
    return this.creating;
  }

  private async resetHarness(): Promise<void> {
    if (this.harness?.session.isRunning) return; // picked up on the next request
    const h = this.harness;
    this.harness = undefined;
    await h?.dispose();
  }

  async pushState(): Promise<void> {
    const folder = this.folder;
    const config = folder ? readConfig(folder) : undefined;
    this.chat.post({
      type: "state",
      hasApiKey: await this.keys.has(),
      prototypes: config ? listPrototypes(config) : [],
      activePrototype: this.harness?.session.state.prototype,
      showCode: this.showCode,
      model: config?.model ?? "",
    });
  }

  // ------------------------------------------------------------------ chat messages

  private async onChatMessage(msg: ChatToExtension): Promise<void> {
    try {
      switch (msg.type) {
        case "ready":
          for (const event of this.transcript) this.chat.post({ type: "event", event });
          await this.pushState();
          break;
        case "send":
          await this.send(msg.text, msg.figmaUrl);
          break;
        case "answer": {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            p.resolve({ answer: msg.answer, approved: msg.approved });
          }
          break;
        }
        case "stop":
          this.stop();
          break;
        case "set_api_key":
          await this.setApiKey();
          break;
        case "new_prototype":
          await this.newPrototype();
          break;
        case "open_prototype":
          await this.openPrototype(msg.name);
          break;
        case "open_preview":
          await this.openPreview();
          break;
        case "set_show_code":
          await this.context.workspaceState.update(SHOW_CODE_KEY, msg.value);
          await this.pushState();
          break;
      }
    } catch (err) {
      this.onEvent({ type: "notice", level: "error", message: (err as Error).message });
      this.output.appendLine((err as Error).stack ?? String(err));
    }
  }

  async send(text: string, figmaUrl?: string): Promise<void> {
    const harness = await this.ensureHarness();
    if (!harness) return;
    if (harness.session.isRunning) {
      this.onEvent({ type: "notice", level: "info", message: "I'm still working on the last request. Stop it first, or wait for it to finish." });
      return;
    }
    await harness.session.send(text, { figmaUrl });
    await this.pushState();
  }

  stop(): void {
    this.harness?.session.stop();
    for (const [id, p] of this.pending) {
      p.reject(new Error("Stopped"));
      this.pending.delete(id);
    }
  }

  async setApiKey(): Promise<void> {
    if (await this.keys.prompt()) {
      void vscode.window.showInformationMessage("Anthropic API key saved to secure storage.");
    }
    await this.pushState();
  }

  async clearApiKey(): Promise<void> {
    await this.keys.clear();
    void vscode.window.showInformationMessage("Anthropic API key removed.");
    await this.pushState();
  }

  async newPrototype(): Promise<void> {
    this.stop();
    await this.resetHarness();
    this.transcript = [];
    this.chat.post({ type: "reset" });
    await this.pushState();
  }

  async openPrototype(name: string): Promise<void> {
    await this.newPrototype();
    const harness = await this.ensureHarness();
    if (!harness) return;
    harness.session.loadPrototype(name);
    this.onEvent({ type: "notice", level: "info", message: `Opened “${name}”. Tell me what to change.` });
    await this.pushState();
    await this.openPreview();
  }

  async openPreview(): Promise<void> {
    const harness = await this.ensureHarness();
    const st = harness?.session.state;
    if (!harness || !st?.prototype) {
      if (this.preview.url) await this.preview.show(this.preview.url);
      else void vscode.window.showInformationMessage("There's no prototype yet. Describe one in the UIUX Harness chat.");
      return;
    }
    const running = this.devServer.current;
    if (running && running.prototype === st.prototype) {
      await this.preview.show(running.url);
      return;
    }
    // Start the server for the active prototype using the same allowlisted command the agent uses.
    const config = readConfig(this.folder!);
    if (!fs.existsSync(path.join(config.workspaceRoot, st.protoRelDir!, "App.tsx"))) {
      void vscode.window.showInformationMessage("This prototype has no screens yet.");
      return;
    }
    const port = await findFreePort(5180);
    const cmd = resolveCommand("dev_server", config.commands, { protoDir: st.protoRelDir!, port });
    const info = await this.devServer.start(cmd, config.workspaceRoot, st.prototype, port, harness.adapter.devServerReadyPattern);
    await this.preview.show(info.url);
  }

  async reindex(): Promise<void> {
    const folder = this.folder;
    if (!folder) return;
    this.catalogue = buildCatalogue(readConfig(folder));
    await this.resetHarness();
    const c = this.catalogue;
    void vscode.window.showInformationMessage(
      `Found ${c.components.length} components and ${c.tokens.length} tokens${c.warnings.length ? ` (${c.warnings.join(" ")})` : ""}.`,
    );
  }

  showConnections(): void {
    if (this.connections.length === 0) {
      void vscode.window.showInformationMessage("Connections are checked when you send your first message.");
      return;
    }
    const items = this.connections.map((c) => ({ label: `${c.state === "connected" ? "$(check)" : "$(warning)"} ${c.name}`, detail: c.note }));
    void vscode.window.showQuickPick(items, { title: "UIUX Harness connections", canPickMany: false });
  }

  dispose(): void {
    this.stop();
    void this.harness?.dispose();
    this.devServer.stop();
    for (const d of this.disposables) d.dispose();
  }
}
