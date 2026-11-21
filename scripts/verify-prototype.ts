/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * Independent verification of a generated prototype (no harness code paths
 * except the command allowlist):
 *   1. type check, lint and a production build all succeed
 *   2. it renders in Chromium with no console errors
 *   3. tab navigation works both ways, deep links and reload keep the tab
 *   4. it renders inside the preview panel's real HTML and CSP
 *
 *   npm run verify-prototype -- --prototype settings
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright";
import { defaultConfig } from "../src/core/config";
import { resolveCommand } from "../src/core/policy/commandPolicy";
import { DevServerManager, findFreePort, runToCompletion } from "../src/core/process/runner";
import { ReactViteAdapter } from "../src/core/adapters/reactVite";
import { previewHtmlForTest } from "./previewHtmlForTest";

const { values } = parseArgs({
  options: { workspace: { type: "string", default: "sample-workspace" }, prototype: { type: "string", default: "settings" } },
});
const ws = path.resolve(values.workspace!);
const protoDir = `prototypes/${values.prototype}`;
const shotsDir = path.join(ws, ".uiux-harness", "verify", values.prototype!);
const results: Array<[string, boolean, string?]> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? `\n    ${detail}` : ""}`);
};

async function tabState(page: Page) {
  return page.evaluate(() => ({
    hash: location.hash,
    selected: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map((t) => t.textContent?.trim()),
    panel: document.querySelector('[role="tabpanel"]')?.textContent ?? "",
  }));
}

/** Wait until the URL hash *and* the rendered selected tab match (React renders after hashchange). */
async function waitForTab(page: Page, hash: string, label: string): Promise<void> {
  await page.waitForFunction(
    ([h, l]) => location.hash === h && document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() === l,
    [hash, label] as const,
    { timeout: 5000 },
  );
}

async function main(): Promise<number> {
  if (!fs.existsSync(path.join(ws, protoDir, "App.tsx"))) {
    console.error(`No prototype at ${protoDir}. Run npm run e2e (or e2e:scripted) first.`);
    return 2;
  }
  fs.mkdirSync(shotsDir, { recursive: true });
  const config = defaultConfig(ws);

  // 1. Static checks and a production build.
  for (const name of ["typecheck", "lint"] as const) {
    const r = await runToCompletion(resolveCommand(name, config.commands, { protoDir }), ws);
    check(`${name} exits 0`, r.exitCode === 0, r.output.slice(-800));
  }
  const build = await runToCompletion(
    { name: "dev_server", executable: "npx", args: ["vite", "build", "--config", `${protoDir}/vite.config.mjs`, "--logLevel", "warn"], display: "vite build" },
    ws,
  );
  check("production build (vite build) succeeds", build.exitCode === 0 && fs.existsSync(path.join(ws, protoDir, "dist/index.html")), build.output.slice(-800));

  // 2-4. Run it.
  const dev = new DevServerManager();
  const port = await findFreePort(5190);
  const info = await dev.start(resolveCommand("dev_server", config.commands, { protoDir, port }), ws, values.prototype!, port, new ReactViteAdapter().devServerReadyPattern);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`${m.type()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

    // Landing: "/" redirects to the first route.
    await page.goto(info.url);
    try {
      await page.waitForSelector("h1", { timeout: 15_000 });
    } catch (err) {
      const root = await page.evaluate(() => document.getElementById("root")?.innerHTML.slice(0, 500));
      console.log("root:", root, "\nconsole:", consoleErrors.join("\n"), "\nserver:", dev.recentOutput(20));
      throw err;
    }
    let s = await tabState(page);
    check("landing URL redirects to #/settings/profile", s.hash === "#/settings/profile", s.hash);
    check("heading 'Settings' renders", (await page.textContent("h1"))?.trim() === "Settings");
    check("Profile tab selected with the profile form", s.selected[0] === "Profile" && (await page.getByLabel("Full name").count()) === 1, JSON.stringify(s.selected));
    await page.screenshot({ path: path.join(shotsDir, "profile.png"), fullPage: true });

    // Profile → Notifications
    await page.getByRole("tab", { name: "Notifications" }).click();
    await waitForTab(page, "#/settings/notifications", "Notifications");
    s = await tabState(page);
    check("clicking Notifications navigates to #/settings/notifications", s.hash === "#/settings/notifications" && s.selected[0] === "Notifications");
    const switches = await page.getByRole("switch").count();
    check("Notifications panel shows the switches", switches >= 3 && s.panel.includes("Weekly digest"), `switches=${switches}`);
    const digest = page.getByRole("switch", { name: "Product updates" });
    const before = await digest.getAttribute("aria-checked");
    await digest.click();
    check("a notification switch toggles", (await digest.getAttribute("aria-checked")) !== before);
    await page.screenshot({ path: path.join(shotsDir, "notifications.png"), fullPage: true });

    // Notifications → Profile, then browser back/forward.
    await page.getByRole("tab", { name: "Profile" }).click();
    await waitForTab(page, "#/settings/profile", "Profile");
    check("clicking Profile navigates back", (await tabState(page)).selected[0] === "Profile");
    await page.goBack();
    await waitForTab(page, "#/settings/notifications", "Notifications");
    check("browser Back returns to Notifications", (await tabState(page)).selected[0] === "Notifications");

    // Deep link + reload.
    await page.goto(`${info.url}#/settings/notifications`);
    await page.reload();
    await waitForTab(page, "#/settings/notifications", "Notifications");
    check("deep link + reload keeps the Notifications tab", (await tabState(page)).selected[0] === "Notifications");

    // Keyboard: arrow keys move between tabs (from the library's Tabs).
    await page.getByRole("tab", { name: "Notifications" }).focus();
    await page.keyboard.press("ArrowLeft");
    await waitForTab(page, "#/settings/profile", "Profile");
    check("arrow keys switch tabs", (await tabState(page)).selected[0] === "Profile");

    // Form behaviour: empty name shows an error, valid save shows success.
    await page.getByLabel("Full name").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    check("saving with an empty name shows a field error", (await page.getByText("Enter your name").count()) === 1);
    await page.getByLabel("Full name").fill("Ada King");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText("Changes saved").waitFor({ timeout: 3000 });
    check("valid save shows the success alert", true);

    const unknown = await browser.newPage();
    await unknown.goto(`${info.url}#/settings/billing`);
    await unknown.waitForFunction(() => location.hash === "#/settings/profile");
    check("unknown tab route falls back to Profile", true);
    await unknown.close();

    check("no console errors or warnings", consoleErrors.length === 0, consoleErrors.join("\n    "));

    // Inside the preview panel's actual HTML + CSP (VS Code webview markup, rendered in Chromium).
    const previewPage = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const html = previewHtmlForTest(`${info.url}#/settings/notifications`);
    const previewFile = path.join(shotsDir, "preview-panel.html");
    fs.writeFileSync(previewFile, html);
    const cspViolations: string[] = [];
    previewPage.on("console", (m) => {
      if (/Content Security Policy|Refused to/.test(m.text())) cspViolations.push(m.text());
    });
    await previewPage.goto(`file://${previewFile}`);
    const frame = previewPage.frameLocator("#frame");
    await frame.getByRole("tab", { name: "Notifications" }).waitFor({ timeout: 10_000 });
    check("prototype renders inside the preview panel HTML (iframe + CSP)", (await frame.getByRole("switch").count()) >= 3 && cspViolations.length === 0, cspViolations.join("\n    "));
    await frame.getByRole("tab", { name: "Profile" }).click();
    await frame.getByLabel("Full name").waitFor();
    check("tab navigation works inside the preview iframe", true);
    await previewPage.screenshot({ path: path.join(shotsDir, "preview-panel.png") });
  } finally {
    await browser.close();
    dev.stop();
  }
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${path.relative(process.cwd(), shotsDir)}`);
  return failed ? 1 : 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
