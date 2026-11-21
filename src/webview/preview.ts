// Preview panel script: toolbar actions and navigation messages from the extension.
import type { ExtensionToPreview, PreviewToExtension } from "../core/protocol";

declare function acquireVsCodeApi(): { postMessage(msg: PreviewToExtension): void };
const vscode = acquireVsCodeApi();

const frame = document.getElementById("frame") as HTMLIFrameElement;
const route = document.getElementById("route") as HTMLSpanElement;

function show(url: string): void {
  route.textContent = url;
  route.title = url;
}

document.getElementById("reload")?.addEventListener("click", () => {
  // Cross-origin: we cannot call frame.contentWindow.location.reload(), so re-set src.
  const src = frame.src;
  frame.src = "about:blank";
  setTimeout(() => (frame.src = src), 30);
});
document.getElementById("external")?.addEventListener("click", () => vscode.postMessage({ type: "open_external", url: frame.src }));

window.addEventListener("message", (e: MessageEvent<ExtensionToPreview>) => {
  const msg = e.data;
  if (msg.type === "navigate") {
    frame.src = msg.url;
    show(msg.url);
  } else if (msg.type === "reload") {
    const src = frame.src;
    frame.src = "about:blank";
    setTimeout(() => (frame.src = src), 30);
  }
});
show(frame.src);
