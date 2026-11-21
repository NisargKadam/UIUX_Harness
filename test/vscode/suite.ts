/**
 * Runs inside the VS Code extension host. Plain assertions, no test framework:
 * run() throws on the first failure, which test-electron reports as a failed run.
 * Prerequisite: a generated prototype at sample-workspace/prototypes/settings
 * (npm run e2e:scripted creates one).
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { HarnessExtensionApi } from "../../src/extension";

const results: string[] = [];
async function step(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    results.push(`✓ ${name}`);
    console.log(`✓ ${name}`);
  } catch (err) {
    console.log(`✗ ${name}: ${(err as Error).message}`);
    throw err;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<HarnessExtensionApi>("nisargkadam.uiux-harness");
  let api!: HarnessExtensionApi;
  const ws = vscode.workspace.workspaceFolders![0]!.uri.fsPath;

  await step("extension activates", async () => {
    assert.ok(ext, "extension not found");
    api = await ext.activate();
    assert.ok(api.controller);
  });

  await step("all commands are registered", async () => {
    const all = await vscode.commands.getCommands(true);
    for (const c of ["setApiKey", "clearApiKey", "openPreview", "newPrototype", "reindexComponents", "stop", "showConnections"]) {
      assert.ok(all.includes(`uiuxHarness.${c}`), `missing uiuxHarness.${c}`);
    }
  });

  await step("chat view and activity view open", async () => {
    await vscode.commands.executeCommand("workbench.view.extension.uiuxHarness");
    await vscode.commands.executeCommand("uiuxHarness.chat.focus");
    await vscode.commands.executeCommand("uiuxHarness.activity.focus");
  });

  await step("API key is stored in SecretStorage, not settings", async () => {
    await api.keys.store("sk-ant-test-not-a-real-key-0000000000");
    assert.equal(await api.keys.has(), true);
    const settings = JSON.stringify(vscode.workspace.getConfiguration("uiuxHarness"));
    assert.ok(!settings.includes("sk-ant-"), "key leaked into settings");
  });

  await step("component catalogue re-scan finds the 12 sample components", async () => {
    await api.controller.reindex();
    const cat = (api.controller as unknown as { catalogue: { components: Array<{ name: string }>; tokens: unknown[] } }).catalogue;
    assert.equal(cat.components.length, 12, cat.components.map((c) => c.name).join(","));
    assert.ok(cat.tokens.length > 40);
  });

  const protoDir = path.join(ws, "prototypes/settings");
  assert.ok(fs.existsSync(path.join(protoDir, "App.tsx")), "run npm run e2e:scripted first to generate prototypes/settings");

  await step("opening an existing prototype starts the dev server and shows the preview panel", async () => {
    await api.controller.openPrototype("settings");
    let tab: vscode.Tab | undefined;
    for (let i = 0; i < 40 && !tab; i++) {
      tab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.includes("uiuxHarness.preview"));
      if (!tab) await sleep(250);
    }
    assert.ok(tab, "preview panel tab not found");
    assert.equal(tab.label, "Prototype preview");
    const url = api.preview.url;
    assert.ok(url && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(url), `unexpected preview url ${url}`);
    const html = await (await fetch(url)).text();
    assert.ok(html.includes('<div id="root">'), "dev server did not serve the prototype");
    const app = await (await fetch(`${url}App.tsx`)).text();
    assert.ok(app.includes("SettingsScreen"), "App.tsx not served");
  });

  await step("diagnostics: host reports VS Code TypeScript errors for an open prototype file", async () => {
    const host = (api.controller as unknown as { host: { getDiagnostics(dir: string, s: AbortSignal): Promise<Array<{ file: string; severity: string; message: string; source: string }> | undefined> } }).host;
    const signal = new AbortController().signal;
    const broken = path.join(protoDir, "screens/BrokenProbe.tsx");
    fs.writeFileSync(broken, 'import { Button } from "@ds";\nexport const BrokenProbe = () => <Button variant="huge">x</Button>;\n');
    try {
      // VS Code's TypeScript service only checks files shown in an editor (see controller.collectDiagnostics).
      await vscode.window.showTextDocument(vscode.Uri.file(broken), { preview: true, preserveFocus: true });
      let probe: Array<{ file: string; severity: string; message: string; source: string }> = [];
      for (let i = 0; i < 30 && probe.length === 0; i++) {
        const diags = (await host.getDiagnostics("prototypes/settings", signal)) ?? [];
        probe = diags.filter((d) => d.file === "prototypes/settings/screens/BrokenProbe.tsx" && d.severity === "error");
        if (probe.length === 0) await sleep(1000);
      }
      assert.ok(probe.length > 0, "no editor diagnostics for the open probe file");
      assert.ok(/huge/.test(probe[0]!.message), probe[0]!.message);
      assert.equal(probe[0]!.source, "ts");
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      fs.rmSync(broken, { force: true });
    }
  });

  await step("new prototype resets the session", async () => {
    await api.controller.newPrototype();
  });

  await step("removing the API key works", async () => {
    await api.keys.clear();
    assert.equal(await api.keys.has(), false);
  });

  api.controller.dispose();
  console.log(`\n${results.length} extension-host checks passed`);
}
