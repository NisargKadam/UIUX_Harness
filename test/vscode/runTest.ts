/**
 * Launches VS Code with the extension under development, opens the sample
 * workspace and runs test/vscode/suite.ts inside the extension host.
 * Uses the locally installed VS Code when present, else downloads one.
 *
 *   npm run test:vscode
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { build } from "esbuild";
import { runTests } from "@vscode/test-electron";

async function main() {
  const root = path.resolve(__dirname, "../..");
  const suite = path.join(root, "out/vscode-suite.js");
  await build({ entryPoints: [path.join(__dirname, "suite.ts")], outfile: suite, bundle: true, platform: "node", format: "cjs", external: ["vscode"], target: "node20", logLevel: "warning" });
  const local = process.platform === "darwin" ? "/Applications/Visual Studio Code.app/Contents/MacOS/Code" : undefined;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "uiux-vscode-test-"));
  await runTests({
    ...(local && fs.existsSync(local) && !process.env.DOWNLOAD_VSCODE ? { vscodeExecutablePath: local } : {}),
    extensionDevelopmentPath: root,
    extensionTestsPath: suite,
    launchArgs: [
      path.join(root, "sample-workspace"),
      "--disable-workspace-trust",
      "--disable-extensions", // other extensions; built-ins (TypeScript) stay on
      "--skip-welcome",
      "--skip-release-notes",
      `--user-data-dir=${path.join(scratch, "user")}`,
      `--extensions-dir=${path.join(scratch, "ext")}`,
    ],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
