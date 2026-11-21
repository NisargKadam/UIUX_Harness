import * as vscode from "vscode";
import { defaultConfig, type Effort, type HarnessConfig, type McpHttpServerConfig, type McpStdioServerConfig } from "../core/config";

/** Read uiuxHarness.* settings for a workspace folder into a HarnessConfig. Contains no secrets. */
export function readConfig(folder: vscode.WorkspaceFolder): HarnessConfig {
  const s = vscode.workspace.getConfiguration("uiuxHarness", folder.uri);
  const d = defaultConfig(folder.uri.fsPath);
  const str = (key: string, fallback: string) => {
    const v = s.get<string>(key);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
  };
  const num = (key: string, fallback: number) => {
    const v = s.get<number>(key);
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const http = (key: string, fallback: McpHttpServerConfig): McpHttpServerConfig => ({ ...fallback, ...(s.get<McpHttpServerConfig>(key) ?? {}) });
  const stdio = (key: string, fallback: McpStdioServerConfig): McpStdioServerConfig => ({ ...fallback, ...(s.get<McpStdioServerConfig>(key) ?? {}) });

  return {
    workspaceRoot: folder.uri.fsPath,
    model: str("model", d.model),
    effort: str("effort", d.effort) as Effort,
    refusalFallback: s.get<boolean>("refusalFallback", d.refusalFallback),
    componentLibraryPath: str("componentLibraryPath", d.componentLibraryPath),
    componentImport: str("componentImport", d.componentImport),
    tokensPath: str("tokensPath", d.tokensPath),
    globalStyles: s.get<string[]>("globalStyles", d.globalStyles),
    storybookUrl: s.get<string>("storybookUrl", "") ?? "",
    prototypeFolder: str("prototypeFolder", d.prototypeFolder),
    framework: (s.get<string>("framework", "auto") as HarnessConfig["framework"]) ?? "auto",
    commands: {
      devServer: str("devServerCommand", d.commands.devServer),
      typecheck: str("typecheckCommand", d.commands.typecheck),
      // An empty lint command is meaningful (skip linting), so read it raw.
      lint: s.get<string>("lintCommand", d.commands.lint) ?? "",
    },
    limits: {
      maxFixAttempts: num("maxFixAttempts", d.limits.maxFixAttempts),
      maxReviewRounds: num("maxReviewRounds", d.limits.maxReviewRounds),
      maxTurns: num("maxTurns", d.limits.maxTurns),
    },
    mcp: {
      figma: http("mcp.figma", d.mcp.figma),
      storybook: http("mcp.storybook", d.mcp.storybook),
      playwright: stdio("mcp.playwright", d.mcp.playwright),
    },
  };
}
