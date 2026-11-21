/**
 * Resolved harness configuration. The VS Code layer reads it from settings
 * (src/vscode/settings.ts); the headless CLI builds it from flags. Nothing in
 * here is secret: the API key never goes through this object.
 */

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface McpHttpServerConfig {
  enabled: boolean;
  url?: string;
}

export interface McpStdioServerConfig {
  enabled: boolean;
  command: string;
  args: string[];
}

export interface HarnessConfig {
  /** Absolute path of the workspace folder. */
  workspaceRoot: string;
  model: string;
  effort: Effort;
  refusalFallback: boolean;
  /** Workspace-relative. */
  componentLibraryPath: string;
  /** Import specifier used by prototypes, e.g. "@ds". */
  componentImport: string;
  /** Workspace-relative file or folder. */
  tokensPath: string;
  /** Workspace-relative stylesheets imported by every prototype. */
  globalStyles: string[];
  storybookUrl: string;
  /** Workspace-relative folder that holds every prototype. */
  prototypeFolder: string;
  framework: "auto" | "react-vite";
  commands: {
    devServer: string;
    typecheck: string;
    lint: string;
  };
  limits: {
    maxFixAttempts: number;
    maxReviewRounds: number;
    maxTurns: number;
  };
  mcp: {
    figma: McpHttpServerConfig;
    storybook: McpHttpServerConfig;
    playwright: McpStdioServerConfig;
  };
}

export const DEFAULT_MODEL = "claude-opus-5-5";

export function defaultConfig(workspaceRoot: string): HarnessConfig {
  return {
    workspaceRoot,
    model: DEFAULT_MODEL,
    effort: "high",
    refusalFallback: true,
    componentLibraryPath: "src/components",
    componentImport: "@ds",
    tokensPath: "src/tokens",
    globalStyles: ["src/tokens/tokens.css"],
    storybookUrl: "",
    prototypeFolder: "prototypes",
    framework: "auto",
    commands: {
      devServer: "npx vite --config {protoDir}/vite.config.mjs --port {port} --strictPort",
      typecheck: "npx tsc --noEmit -p {protoDir}/tsconfig.json",
      lint: "npx eslint {protoDir}",
    },
    limits: { maxFixAttempts: 3, maxReviewRounds: 3, maxTurns: 80 },
    mcp: {
      figma: { enabled: true, url: "http://127.0.0.1:3845/mcp" },
      storybook: { enabled: true },
      playwright: {
        enabled: true,
        command: "npx",
        args: ["-y", "@playwright/mcp@0.0.86", "--headless", "--isolated", "--viewport-size", "1280x800"],
      },
    },
  };
}
