/** Preview panel markup. Kept free of the vscode module so tests can render it in a browser. */
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
