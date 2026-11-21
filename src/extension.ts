import * as vscode from "vscode";
import { ActivityView } from "./vscode/activityView";
import { ChatView } from "./vscode/chatView";
import { Controller } from "./vscode/controller";
import { PreviewPanel } from "./vscode/previewPanel";
import { ApiKeyStore } from "./vscode/secrets";

export function activate(context: vscode.ExtensionContext): { controller: Controller } {
  const output = vscode.window.createOutputChannel("UIUX Harness");
  const chat = new ChatView(context.extensionUri);
  const preview = new PreviewPanel(context.extensionUri);
  const activity = new ActivityView();
  const keys = new ApiKeyStore(context.secrets);
  const controller = new Controller(context, chat, preview, activity, keys, output);

  context.subscriptions.push(
    output,
    preview,
    controller,
    vscode.window.registerWebviewViewProvider(ChatView.viewId, chat, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerTreeDataProvider("uiuxHarness.activity", activity),
    vscode.commands.registerCommand("uiuxHarness.setApiKey", () => controller.setApiKey()),
    vscode.commands.registerCommand("uiuxHarness.clearApiKey", () => controller.clearApiKey()),
    vscode.commands.registerCommand("uiuxHarness.openPreview", () => controller.openPreview()),
    vscode.commands.registerCommand("uiuxHarness.newPrototype", () => controller.newPrototype()),
    vscode.commands.registerCommand("uiuxHarness.reindexComponents", () => controller.reindex()),
    vscode.commands.registerCommand("uiuxHarness.stop", () => controller.stop()),
    vscode.commands.registerCommand("uiuxHarness.showConnections", () => controller.showConnections()),
  );
  // Returned for integration tests.
  return { controller };
}

export function deactivate(): void {
  // Disposables registered on the context (controller → dev server, MCP clients) are cleaned up by VS Code.
}
