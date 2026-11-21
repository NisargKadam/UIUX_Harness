/**
 * Wires a session together: catalogue → MCP connections → skills → system
 * prompt → AgentSession. Used by both the VS Code extension and the headless CLI.
 */
import Anthropic from "@anthropic-ai/sdk";
import { pickAdapter } from "./adapters/reactVite";
import type { FrameworkAdapter } from "./adapters/types";
import { formatCatalogueForPrompt, indexComponents } from "./catalogue/indexer";
import type { Catalogue } from "./catalogue/types";
import type { HarnessConfig } from "./config";
import type { HarnessHost } from "./host";
import { McpManager } from "./mcp/manager";
import { DevServerManager } from "./process/runner";
import type { ConnectionStatus } from "./protocol";
import { AgentSession } from "./agent/session";
import { buildSystemPrompt } from "./agent/systemPrompt";
import { loadSkills, type Skill } from "./skills/loader";

export interface Harness {
  session: AgentSession;
  catalogue: Catalogue;
  connections: ConnectionStatus[];
  skills: Skill[];
  adapter: FrameworkAdapter;
  devServer: DevServerManager;
  mcp: McpManager;
  dispose(): Promise<void>;
}

export interface HarnessOptions {
  config: HarnessConfig;
  host: HarnessHost;
  /** Folder with bundled skills (skills/<name>/SKILL.md). */
  skillsDir: string;
  /** Explicit API key (from SecretStorage). Omit to use the SDK's default credential chain. */
  apiKey?: string;
  /** Reuse a dev server across sessions (the extension keeps one alive). */
  devServer?: DevServerManager;
  /** Reuse a catalogue (indexing takes a second on large libraries). */
  catalogue?: Catalogue;
}

export function buildCatalogue(config: HarnessConfig): Catalogue {
  return indexComponents({
    workspaceRoot: config.workspaceRoot,
    libraryPath: config.componentLibraryPath,
    tokensPath: config.tokensPath,
    importFrom: config.componentImport,
  });
}

export async function createHarness(opts: HarnessOptions): Promise<Harness> {
  const { config, host } = opts;
  const adapter = pickAdapter(config.workspaceRoot, config.framework);
  const catalogue = opts.catalogue ?? buildCatalogue(config);
  const mcp = new McpManager(config, () => catalogue, (m) => host.log(m));
  const connections = await mcp.connectAll();
  host.emit({ type: "connections", items: connections });
  const skills = loadSkills(opts.skillsDir, config.workspaceRoot);
  const system = buildSystemPrompt({
    config,
    adapter,
    skills,
    catalogueSummary: formatCatalogueForPrompt(catalogue),
    connections,
  });
  const client = new Anthropic({
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    maxRetries: 3,
    timeout: 10 * 60 * 1000,
  });
  const devServer = opts.devServer ?? new DevServerManager();
  const session = new AgentSession({ client, config, host, adapter, mcp, devServer, system });
  return {
    session,
    catalogue,
    connections,
    skills,
    adapter,
    devServer,
    mcp,
    async dispose() {
      session.stop();
      await mcp.closeAll();
      if (!opts.devServer) devServer.stop();
    },
  };
}
