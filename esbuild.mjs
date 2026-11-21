// Bundles the extension host code (CommonJS, Node) and the webview scripts (browser IIFE).
import * as fs from "node:fs";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

// Production builds start clean so stale source maps and test shims never ship.
if (production) fs.rmSync("dist", { recursive: true, force: true });

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
  }),
  esbuild.context({
    ...common,
    entryPoints: { chat: "src/webview/chat.ts", preview: "src/webview/preview.ts" },
    outdir: "dist/webview",
    platform: "browser",
    format: "iife",
    target: "es2022",
  }),
]);

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
