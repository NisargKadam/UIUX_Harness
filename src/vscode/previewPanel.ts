import * as vscode from "vscode";
import type { ExtensionToPreview, PreviewToExtension } from "../core/protocol";
import { nonce } from "./webviewUtil";

/**
 * Live preview: a webview panel beside the editor with the prototype's dev
 * server in an iframe. The URL goes through env.asExternalUri, so the preview
 * also works in remote / Codespaces windows, and its origin is allowed in the
 * CSP's frame-src.
 */
export class PreviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private frameOrigin: string | undefined;
  private lastUrl: string | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  get url(): string | undefined {
    return this.lastUrl;
  }

  async show(url: string): Promise<void> {
    const external = (await vscode.env.asExternalUri(vscode.Uri.parse(url))).toString(true);
    const origin = new URL(external).origin;
    this.lastUrl = url;
    if (this.panel && this.frameOrigin === origin) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      this.post({ type: "navigate", url: external });
      return;
    }
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "uiuxHarness.preview",
        "Prototype preview",
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview"), vscode.Uri.joinPath(this.extensionUri, "media")],
        },
      );
      this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "harness.svg");
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.frameOrigin = undefined;
      });
      this.panel.webview.onDidReceiveMessage((msg: PreviewToExtension) => {
        if (msg.type === "open_external") void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        if (msg.type === "reload") this.post({ type: "reload" });
      });
    }
    this.frameOrigin = origin;
    this.panel.webview.html = this.html(this.panel.webview, external, origin);
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  async navigate(url: string): Promise<void> {
    await this.show(url);
  }

  async reload(): Promise<void> {
    if (this.panel) this.post({ type: "reload" });
    else if (this.lastUrl) await this.show(this.lastUrl);
  }

  private post(msg: ExtensionToPreview): void {
    void this.panel?.webview.postMessage(msg);
  }

  /** Exposed for tests: the panel HTML is deterministic for a given URL. */
  html(webview: vscode.Webview, frameUrl: string, frameOrigin: string): string {
    const n = nonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "preview.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "preview.css"));
    return previewHtml({ cspSource: webview.cspSource, nonce: n, scriptUri: script.toString(), styleUri: style.toString(), frameUrl, frameOrigin });
  }

  dispose(): void {
    this.panel?.dispose();
  }
}

export function previewHtml(o: { cspSource: string; nonce: string; scriptUri: string; styleUri: string; frameUrl: string; frameOrigin: string }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const csp = [
    "default-src 'none'",
    `frame-src ${o.frameOrigin}`,
    `style-src ${o.cspSource}`,
    `img-src ${o.cspSource} data:`,
    `script-src 'nonce-${o.nonce}'`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${o.styleUri}" />
  <title>Prototype preview</title>
</head>
<body>
  <header class="bar">
    <span class="route" id="route" title="${esc(o.frameUrl)}">${esc(o.frameUrl)}</span>
    <button id="reload" type="button" title="Reload the prototype">Reload</button>
    <button id="external" type="button" title="Open in your browser">Open in browser</button>
  </header>
  <iframe id="frame" src="${esc(o.frameUrl)}" title="Prototype" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"></iframe>
  <script nonce="${o.nonce}" src="${o.scriptUri}"></script>
</body>
</html>`;
}
