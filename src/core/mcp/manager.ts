/**
 * MCP connections: Figma, the component catalogue and Playwright. Each one is
 * optional. A server that is disabled or unreachable is reported as such, its
 * tools are left out, and the run carries on without it. Tools are namespaced
 * (figma__*, catalogue__*, playwright__*) so the model can tell where a tool
 * comes from and names cannot collide.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { HarnessConfig } from "../config";
import { validateArgv } from "../policy/commandPolicy";
import type { ConnectionStatus } from "../protocol";
import type { Catalogue } from "../catalogue/types";
import { createCatalogueServer } from "./catalogueServer";

export type ServerKey = "figma" | "catalogue" | "playwright";

type ToolResultContent = Exclude<Anthropic.Beta.BetaToolResultBlockParam["content"], string | undefined>;

interface Binding {
  server: ServerKey;
  name: string;
  original: string;
  client: Client;
  definition: Anthropic.Beta.BetaTool;
}

const CLIENT_INFO = { name: "uiux-harness", version: "0.1.0" };
const MAX_TEXT = 30_000;
const MAX_IMAGES = 3;
const SUPPORTED_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Per-server tool allow-lists (deny by default):
 * - Figma: read tools only ("get_*", "search_*", "whoami"). Nothing that writes to the canvas.
 * - Playwright: navigation, interaction and inspection only. No code evaluation,
 *   file upload, storage or network dumps. Its file-writing `filename` parameter
 *   is stripped too (see PLAYWRIGHT_STRIPPED_PARAMS), because Playwright MCP
 *   lets it write anywhere under its working directory.
 * - Catalogue: the built-in tools, plus Storybook's read-only docs/story lookups.
 *   Storybook's test-run and review tools would execute project code.
 */
const PLAYWRIGHT_TOOLS = new Set([
  "browser_navigate",
  "browser_navigate_back",
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_select_option",
  "browser_hover",
  "browser_press_key",
  "browser_handle_dialog",
  "browser_snapshot",
  "browser_take_screenshot",
  "browser_wait_for",
  "browser_resize",
  "browser_tabs",
  "browser_console_messages",
  "browser_close",
]);
const PLAYWRIGHT_STRIPPED_PARAMS = ["filename"];

export function isToolAllowed(server: ServerKey, tool: string): boolean {
  switch (server) {
    case "figma":
      return /^(get_|search_)/.test(tool) || tool === "whoami";
    case "playwright":
      return PLAYWRIGHT_TOOLS.has(tool);
    case "catalogue":
      return ["list_components", "get_component", "list_tokens"].includes(tool) || /^(docs-|get-|list-|stories-find)/.test(tool);
  }
}

/** Remove parameters the harness never lets the model pass (from a JSON schema). */
export function stripParams(server: ServerKey, schema: Record<string, unknown>): Record<string, unknown> {
  if (server !== "playwright") return schema;
  const props = { ...((schema.properties as Record<string, unknown> | undefined) ?? {}) };
  for (const p of PLAYWRIGHT_STRIPPED_PARAMS) delete props[p];
  const required = Array.isArray(schema.required) ? (schema.required as string[]).filter((r) => !PLAYWRIGHT_STRIPPED_PARAMS.includes(r)) : schema.required;
  return { ...schema, properties: props, ...(required ? { required } : {}) };
}

function toolName(server: ServerKey, original: string): string {
  return `${server}__${original}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Where to look for a Storybook MCP endpoint, if anywhere. */
export function storybookMcpUrl(config: HarnessConfig): string | undefined {
  if (!config.mcp.storybook.enabled) return undefined;
  if (config.mcp.storybook.url) return config.mcp.storybook.url;
  if (config.storybookUrl) return `${config.storybookUrl.replace(/\/$/, "")}/mcp`;
  if (fs.existsSync(path.join(config.workspaceRoot, ".storybook"))) return "http://localhost:6006/mcp";
  return undefined;
}

export class McpManager {
  private bindings = new Map<string, Binding>();
  private clients: Client[] = [];
  private statuses: ConnectionStatus[] = [];
  private playwrightDir: string | undefined;

  constructor(
    private readonly config: HarnessConfig,
    private readonly catalogue: () => Catalogue,
    private readonly log: (message: string) => void = () => {},
  ) {}

  get status(): ConnectionStatus[] {
    return this.statuses;
  }

  isConnected(server: ServerKey): boolean {
    return [...this.bindings.values()].some((b) => b.server === server);
  }

  /** Connect everything that is enabled, in parallel. Never throws. */
  async connectAll(): Promise<ConnectionStatus[]> {
    const [figma, catalogue, playwright] = await Promise.all([this.connectFigma(), this.connectCatalogue(), this.connectPlaywright()]);
    this.statuses = [figma, catalogue, playwright];
    return this.statuses;
  }

  private async attach(server: ServerKey, transport: Transport, timeoutMs: number): Promise<number> {
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    await withTimeout(client.connect(transport), timeoutMs, `Connecting to ${server}`);
    this.clients.push(client);
    const listed = await withTimeout(client.listTools(), timeoutMs, `Listing ${server} tools`);
    let allowed = 0;
    for (const tool of listed.tools) {
      if (!isToolAllowed(server, tool.name)) continue;
      allowed++;
      const name = toolName(server, tool.name);
      const { $schema: _ignored, ...raw } = (tool.inputSchema ?? { type: "object" }) as Record<string, unknown>;
      const schema = stripParams(server, raw);
      this.bindings.set(name, {
        server,
        name,
        original: tool.name,
        client,
        definition: {
          name,
          description: `[${server}] ${(tool.description ?? tool.title ?? tool.name).slice(0, 1500)}`,
          input_schema: { type: "object", ...schema } as Anthropic.Beta.BetaTool.InputSchema,
          eager_input_streaming: true,
        },
      });
    }
    return allowed;
  }

  private async connectFigma(): Promise<ConnectionStatus> {
    const cfg = this.config.mcp.figma;
    if (!cfg.enabled || !cfg.url) {
      return { name: "figma", state: "disabled", note: "Figma is turned off. Briefs are text-only." };
    }
    try {
      const count = await this.attach("figma", new StreamableHTTPClientTransport(new URL(cfg.url)), 5_000);
      return { name: "figma", state: "connected", note: `Connected to Figma (${count} tools).` };
    } catch (err) {
      const remote = /mcp\.figma\.com/.test(cfg.url);
      const hint = remote
        ? "The remote Figma server only accepts sign-in from approved apps. Use the Figma desktop app's MCP server instead (see README)."
        : "Open the Figma desktop app and turn on Dev Mode → MCP server.";
      this.log(`figma: ${(err as Error).message}`);
      return { name: "figma", state: "unavailable", note: `Figma isn't reachable. ${hint}` };
    }
  }

  private async connectCatalogue(): Promise<ConnectionStatus> {
    // The built-in indexer is always attached in-process. Storybook is added when reachable.
    const notes: string[] = [];
    const sbUrl = storybookMcpUrl(this.config);
    if (sbUrl) {
      try {
        const count = await this.attach("catalogue", new StreamableHTTPClientTransport(new URL(sbUrl)), 5_000);
        notes.push(`Using Storybook at ${sbUrl.replace(/\/mcp$/, "")} (${count} tools)`);
      } catch (err) {
        this.log(`storybook: ${(err as Error).message}`);
        notes.push(`Storybook not reachable at ${sbUrl.replace(/\/mcp$/, "")}, so using the built-in scan`);
      }
    }
    try {
      const server = createCatalogueServer(this.catalogue);
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      await this.attach("catalogue", clientSide, 5_000);
      const cat = this.catalogue();
      notes.push(`${cat.components.length} components and ${cat.tokens.length} tokens from ${cat.libraryPath}`);
      return { name: "catalogue", state: "connected", note: notes.join(". ") + "." };
    } catch (err) {
      return { name: "catalogue", state: "unavailable", note: `Component catalogue failed: ${(err as Error).message}` };
    }
  }

  private async connectPlaywright(): Promise<ConnectionStatus> {
    const cfg = this.config.mcp.playwright;
    if (!cfg.enabled) {
      return { name: "playwright", state: "disabled", note: "Self-review in a browser is turned off." };
    }
    try {
      // Same allowlist rules as run_command, with the MCP package as the only allowed tool.
      validateArgv(cfg.command, cfg.args, { allowedPackageTools: new Set(["@playwright/mcp"]) });
      // Run it in a throwaway folder: Playwright MCP confines file output to its
      // working directory, so this keeps it out of the workspace entirely.
      this.playwrightDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "uiux-harness-playwright-"));
      const transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        cwd: this.playwrightDir,
        stderr: "pipe",
      });
      const count = await this.attach("playwright", transport, 90_000);
      return { name: "playwright", state: "connected", note: `Browser ready for self-review (${count} tools).` };
    } catch (err) {
      this.log(`playwright: ${(err as Error).message}`);
      return {
        name: "playwright",
        state: "unavailable",
        note: `Couldn't start the review browser (${(err as Error).message.split("\n")[0]}). Prototypes still build; visual self-review is skipped.`,
      };
    }
  }

  toolDefinitions(): Anthropic.Beta.BetaTool[] {
    // Sorted so the tool list (and therefore the prompt cache prefix) is deterministic.
    return [...this.bindings.values()].map((b) => b.definition).sort((a, b) => a.name.localeCompare(b.name));
  }

  has(name: string): boolean {
    return this.bindings.has(name);
  }

  serverOf(name: string): ServerKey | undefined {
    return this.bindings.get(name)?.server;
  }

  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ content: ToolResultContent; isError: boolean }> {
    const binding = this.bindings.get(name);
    if (!binding) return { content: [{ type: "text", text: `Unknown tool ${name}` }], isError: true };
    if (binding.server === "playwright" && PLAYWRIGHT_STRIPPED_PARAMS.some((p) => p in args)) {
      return { content: [{ type: "text", text: "Saving browser output to files is not allowed. Omit `filename`; results come back inline." }], isError: true };
    }
    const result = await binding.client.callTool({ name: binding.original, arguments: args }, undefined, {
      signal,
      timeout: 120_000,
    });
    return { content: convertContent(result.content), isError: result.isError === true };
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(this.clients.map((c) => c.close()));
    this.clients = [];
    this.bindings.clear();
    if (this.playwrightDir) fs.rmSync(this.playwrightDir, { recursive: true, force: true });
    this.playwrightDir = undefined;
  }
}

/** Convert MCP content items into Anthropic tool_result content (text + images). */
export function convertContent(items: unknown): ToolResultContent {
  const out: ToolResultContent = [];
  let images = 0;
  let textBudget = MAX_TEXT;
  const pushText = (text: string) => {
    if (textBudget <= 0) return;
    const clipped = text.length > textBudget ? `${text.slice(0, textBudget)}\n…[truncated ${text.length - textBudget} chars]` : text;
    textBudget -= clipped.length;
    out.push({ type: "text", text: clipped });
  };
  for (const item of Array.isArray(items) ? items : []) {
    const it = item as { type?: string; text?: string; data?: string; mimeType?: string; resource?: { uri?: string; text?: string }; uri?: string; name?: string };
    if (it.type === "text" && typeof it.text === "string") pushText(it.text);
    else if (it.type === "image" && it.data && it.mimeType) {
      if (images < MAX_IMAGES && SUPPORTED_IMAGES.has(it.mimeType)) {
        images++;
        out.push({
          type: "image",
          source: { type: "base64", media_type: it.mimeType as "image/png", data: it.data },
        });
      } else {
        pushText(`[image omitted: ${it.mimeType}]`);
      }
    } else if (it.type === "resource" && it.resource) {
      pushText(it.resource.text ?? `[resource ${it.resource.uri ?? ""}]`);
    } else if (it.type === "resource_link") {
      pushText(`[resource link ${it.name ?? ""} ${it.uri ?? ""}]`);
    }
  }
  if (out.length === 0) out.push({ type: "text", text: "(no output)" });
  return out;
}
