/**
 * The preview panel's HTML, built by the same previewHtml() the extension uses,
 * with file:// stand-ins for webview resource URIs so it can be loaded in a
 * plain browser. The CSP, iframe sandbox and markup are identical to what
 * VS Code receives.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { previewHtml } from "../src/vscode/previewHtml";

export function previewHtmlForTest(frameUrl: string): string {
  const root = path.resolve(__dirname, "..");
  const script = path.join(root, "dist/webview/preview.js");
  if (!fs.existsSync(script)) throw new Error("Run npm run build first (dist/webview/preview.js is missing).");
  // acquireVsCodeApi is provided by VS Code; stub it for the browser.
  const shim = path.join(root, "dist/webview/vscode-shim.js");
  fs.writeFileSync(shim, "window.acquireVsCodeApi = () => ({ postMessage() {} });\n");
  const fileOrigin = "file:";
  const html = previewHtml({
    cspSource: fileOrigin,
    nonce: "testnonce",
    scriptUri: pathToFileURL(script).toString(),
    styleUri: pathToFileURL(path.join(root, "media/preview.css")).toString(),
    frameUrl,
    frameOrigin: new URL(frameUrl).origin,
  });
  return html.replace("<script nonce", `<script nonce="testnonce" src="${pathToFileURL(shim).toString()}"></script>\n  <script nonce`);
}
