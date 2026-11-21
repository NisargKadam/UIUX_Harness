import * as vscode from "vscode";
import type { ChatToExtension, ExtensionToChat } from "../core/protocol";
import { nonce } from "./webviewUtil";

/** The chat sidebar view. Rendering lives in src/webview/chat.ts; this class is only the bridge. */
export class ChatView implements vscode.WebviewViewProvider {
  static readonly viewId = "uiuxHarness.chat";
  private view: vscode.WebviewView | undefined;
  private readonly received = new vscode.EventEmitter<ChatToExtension>();
  readonly onMessage = this.received.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview"), vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: ChatToExtension) => this.received.fire(msg));
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  post(msg: ExtensionToChat): void {
    void this.view?.webview.postMessage(msg);
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`${ChatView.viewId}.focus`);
  }

  private html(webview: vscode.Webview): string {
    const n = nonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "chat.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "chat.css"));
    const csp = [`default-src 'none'`, `style-src ${webview.cspSource}`, `img-src ${webview.cspSource} data:`, `script-src 'nonce-${n}'`].join("; ");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${style}" />
  <title>UIUX Harness</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${n}" src="${script}"></script>
</body>
</html>`;
  }
}
