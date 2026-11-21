# UIUX Harness

Turn a rough description or a Figma frame into a **clickable prototype built from your team's real components**, with a live preview right inside VS Code.

Because the prototype uses the same components and design tokens engineering ships, what you test with stakeholders is what can actually be built. When something you need doesn't exist in the library, the harness doesn't fake it. It uses the closest real component and adds the gap to a **missing components** list for the design-system team.

You never need to read code. You describe, you watch the preview, and you give feedback in plain language.

```
┌─ UIUX Harness ──────────┐ ┌─ Prototype preview ─────────────────────┐
│ You: a settings page    │ │  Settings                               │
│ with a profile form and │ │  ┌ Profile ┐ Notifications              │
│ a notifications tab     │ │  ┌───────────────────────────────────┐  │
│                         │ │  │ (AL) Ada Lovelace  [Change photo]  │  │
│ ┌ Plan: Account settings│ │  │ Full name   [Ada Lovelace       ]  │  │
│ │ • Profile  /settings/…│ │  │ Email       [ada@acme.example   ]  │  │
│ │ • Notifications …     │ │  │                     [Save changes] │  │
│ │ [Build it] [Change…]  │ │  └───────────────────────────────────┘  │
│ What's happening        │ │                                         │
│ ✓ Building the Settings…│ │                                         │
│ ⟳ Clicking “Notificati… │ │                                         │
└─────────────────────────┘ └─────────────────────────────────────────┘
```

---

## Five-minute walkthrough (for designers)

**1. Open your project.** In VS Code: *File → Open Folder…* and choose your team's front-end project (or this repo's `sample-workspace/` to try it out).

**2. Open the harness.** Click the UIUX Harness icon (a little browser window) in the left bar. You'll see **Chat** and, below it, **What's happening**.

**3. Add your API key (once).** Click **Add key** in the chat and paste your Anthropic API key. It's stored in VS Code's secure storage, not in your project or settings.

**4. Describe what you want.** Type something like:

> a settings page with a profile form and a notifications tab

To work from a design, click **Add a Figma frame** and paste the frame's link (right-click the frame in Figma → *Copy link to selection*).

**5. Check the plan.** Before building anything, the harness shows a plan card:
- the screens, each with its own link
- the click flow between them
- the components it will use
- anything missing from your library
- the assumptions it made

Click **Build it**, or **Change something** and say what's different. If your brief could mean two genuinely different things (say, a pop-up or a new page), it asks you one question first.

**6. Watch it build.** *What's happening* shows each step in plain words: "Building the Settings screen", "Checking the prototype for errors", "Clicking “Notifications tab”". The **Prototype preview** opens beside your editor once there's something to see. The harness checks its own work: it clicks through every path in the plan, compares against your Figma frame if you gave one, fixes what's off, and tells you plainly what's still not right.

**7. Give feedback.** Just type, for example:
- "make the table denser"
- "add an empty state for when there are no notifications"
- "move Save to the top"

It changes the same prototype and re-checks it.

**8. Share it.** Click **Open in browser** in the preview to get a link you can open in any browser on your machine. Each tab and screen has its own link, so you can drop someone straight into "Notifications". The prototype lives in `prototypes/<name>/` in your project. `MISSING_COMPONENTS.md` in that folder is the list to hand to engineering.

Useful bits:
- **Show code** (chat header) reveals the file changes behind each step. It's off by default.
- **Stop** halts the current run at any time.
- The **prototype menu** in the chat header switches between prototypes you've made, so you can continue an old one.
- *What's happening → Connections* shows whether Figma, your component catalogue and the review browser are connected.

---

## Install

Requirements: VS Code 1.95 or later, Node.js 20 or later, and a React + Vite project (or the bundled `sample-workspace`).

```bash
git clone https://github.com/NisargKadam/UIUX_Harness.git
cd UIUX_Harness
npm install
npm run package                      # production build + uiux-harness-0.1.0.vsix
code --install-extension uiux-harness-0.1.0.vsix
```

To develop the extension itself, open this repo in VS Code and press **F5**. That runs an Extension Development Host. Open `sample-workspace/` in it and `cd sample-workspace && npm install` once.

The extension needs a **trusted workspace**, because it runs your dev server, type checker and linter.

## Configuration

All settings are under **Settings → Extensions → UIUX Harness** (`uiuxHarness.*`). Your API key is **not** a setting. Use *UIUX Harness: Set Anthropic API key* or *Remove stored Anthropic API key*.

| Setting | Default | What it does |
|---|---|---|
| `model` | `claude-opus-5-5` | Claude model ID used by the agent. |
| `effort` | `high` | How hard the model thinks per step (`low`…`max`). |
| `refusalFallback` | `true` | Let the API retry on a fallback model if a request is declined. |
| `componentLibraryPath` | `src/components` | Folder with your components. Scanned to build the catalogue. |
| `componentImport` | `@ds` | Import name prototypes use (`import { Button } from "@ds"`). It is mapped to the folder above. |
| `tokensPath` | `src/tokens` | Tokens file or folder (CSS custom properties, W3C token JSON, or TS objects). |
| `globalStyles` | `["src/tokens/tokens.css"]` | Stylesheets every prototype imports. |
| `storybookUrl` | *(empty)* | e.g. `http://localhost:6006`. Enables the Storybook catalogue. |
| `prototypeFolder` | `prototypes` | Where prototypes go. The agent cannot write anywhere else. |
| `framework` | `auto` | Framework adapter (`react-vite` today). |
| `devServerCommand` | `npx vite --config {protoDir}/vite.config.mjs --port {port} --strictPort` | Starts the preview server. |
| `typecheckCommand` | `npx tsc --noEmit -p {protoDir}/tsconfig.json` | Type check. |
| `lintCommand` | `npx eslint {protoDir}` | Lint (leave empty to skip). |
| `maxFixAttempts` / `maxReviewRounds` / `maxTurns` | `3` / `3` / `80` | Retry and safety limits. |
| `mcp.figma` / `mcp.storybook` / `mcp.playwright` | see below | MCP server connections. |

Commands are allowlisted. They must start with `npx`, `npm`, `pnpm`, `yarn`, `bun`, `node`, `vite`, `tsc` or `eslint`, and `npx` may only run `vite`, `tsc` or `eslint`. Shell features (`&&`, `|`, `;`, `$()`, globs) are rejected. The agent picks a command by name (`dev_server`, `typecheck`, `lint`) and never types one.

**Your own skills.** The four skills that steer quality ship with the extension in `skills/`. To tune one for your design system, copy it to `.uiux-harness/skills/<name>/SKILL.md` in your project and edit it. The workspace copy wins.

## The three MCP connections

Each connection is optional. If one is off or unreachable, the harness says so in plain words and carries on without it.

### 1. Figma: reading frames, variables and component names

Default: `{"enabled": true, "url": "http://127.0.0.1:3845/mcp"}`, which is the **Figma desktop app's local MCP server**.

1. Install the Figma desktop app and sign in. This needs a Dev or Full seat on a paid plan.
2. Open your design file and switch to **Dev Mode** (`Shift+D`).
3. In the inspect panel, under **MCP server**, click **Enable desktop MCP server**.
4. Paste frame links into the harness chat. It reads the frame's layout, variables and component names, and takes a screenshot to compare against during self-review.

The harness only uses Figma's **read** tools (`get_design_context`, `get_metadata`, `get_variable_defs`, `get_screenshot`, …). Tools that write to the canvas are filtered out.

*Remote server:* Figma's hosted server (`https://mcp.figma.com/mcp`) signs in with OAuth, and Figma currently only accepts **approved clients** from its MCP catalog. This extension isn't on that list, so use the desktop server above. If Figma approves the client later, set `uiuxHarness.mcp.figma.url` to the remote URL.

### 2. Component catalogue: Storybook, or the built-in scanner

The harness always has a catalogue:

- **Built-in scanner (default).** Reads `componentLibraryPath` with the TypeScript compiler and lists each component's props: types, required or optional, allowed values (`"primary" | "secondary"`), defaults, JSDoc descriptions, `@category` and `@example`. It also reads your tokens. Run *UIUX Harness: Re-scan component library* after changing components. Tip: good JSDoc on your components makes better prototypes.
- **Storybook MCP (if you use Storybook).** Install the official addon in your project:
  ```bash
  npx storybook add @storybook/addon-mcp
  ```
  Enable `features: { componentsManifest: true }` in `.storybook/main.ts`, run Storybook, and set `uiuxHarness.storybookUrl` to `http://localhost:6006`. If a `.storybook/` folder exists, this is the default. The harness connects to `<storybookUrl>/mcp` and adds Storybook's docs tools alongside the scanner. If Storybook isn't running, it falls back to the scanner.

### 3. Playwright: screenshots and click-through for self-review

Default: `{"enabled": true, "command": "npx", "args": ["-y", "@playwright/mcp@0.0.86", "--headless", "--isolated", "--viewport-size", "1280x800", "--output-dir", ".uiux-harness/playwright"]}`.

Nothing to set up beyond Node. The first run downloads the Playwright MCP package and a browser, which takes a minute. Screenshots and snapshots go to `.uiux-harness/playwright/` (gitignored). Tools that run arbitrary code (`browser_run_code_unsafe`) or upload local files are filtered out. Set `enabled: false` to skip visual self-review. Type and lint checks still run.

---

## How it works

```
Chat (webview) ── Controller ── AgentSession (Messages API loop, streaming)
                       │            ├─ 6 built-in tools ─┬─ read_file
Preview panel ◄────────┤            │                    ├─ write_file   → path guard: prototypes/<name>/ only
(iframe → dev server)  │            │                    ├─ run_command  → allowlist: dev_server | typecheck | lint
                       │            │                    ├─ get_diagnostics (VS Code + tsc)
What's happening ◄─────┘            │                    ├─ preview (open / reload / navigate)
(activity tree)                     │                    └─ ask_user (plan approval unlocks writes)
                                    ├─ MCP: figma__* · catalogue__* · playwright__*
                                    ├─ 4 skills (SKILL.md) in the system prompt
                                    └─ quality gates: type check + lint, preview up, self-review
```

- **Agent loop.** Runs directly on the Anthropic Messages API, not the Claude Agent SDK. The Agent SDK spawns a ~350 MB native binary per platform, and the write restriction is simplest to guarantee in-process. See [docs/adr/0001-agent-loop.md](docs/adr/0001-agent-loop.md).
- **Guard rails are code, not prompts.**
  - Plan first: `write_file` refuses until you approve a plan.
  - Writes are confined to `prototypes/<name>/`. The guard resolves `..` and symlinks, blocks secrets-like files, and reserves build configs such as `vite.config.*`, `eslint.config.*`, `package.json` and `tsconfig*.json`, because the dev server would execute them.
  - Commands are chosen by name only.
  - "Done" means the type check and lint pass. The loop sends the model back to fix errors, up to `maxFixAttempts`, then reports what's left.
- **Framework adapter.** Everything React + Vite-specific (plumbing files, hash router, output parsing) lives in `src/core/adapters/reactVite.ts` behind the `FrameworkAdapter` interface. The core in `src/core` never imports `vscode`, so the same loop also runs headless.

## Development

```bash
npm run build          # esbuild: extension + webviews → dist/
npm run typecheck      # tsc (extension + webview)
npm run lint
npm test               # unit tests (vitest): path guard, command allowlist, indexer, MCP filters, diagnostics, ...
npm run smoke          # plumbing without a model: scaffold → tsc → eslint → vite → MCP
npm run e2e:scripted   # real agent loop + tools + MCP, with a scripted stand-in for the model
npm run verify-prototype -- --prototype settings   # independent Playwright check of a generated prototype
npm run test:vscode    # extension-host tests inside VS Code (run e2e:scripted first)
npm run e2e -- --brief "a settings page with a profile form and a notifications tab"   # real model; needs ANTHROPIC_API_KEY
```

`npm run e2e` uses the Anthropic SDK's default credentials (`ANTHROPIC_API_KEY` in your environment). It auto-approves plans and logs each run to `sample-workspace/.uiux-harness/runs/`.

## Project layout

```
src/core/        agent loop, tools, policies, catalogue, MCP, adapters (no vscode import)
src/vscode/      controller, chat view, preview panel, activity view, settings, secrets
src/webview/     chat and preview UI scripts
skills/          brief-interpretation, component-mapping, prototype-scaffolding, self-review
sample-workspace/ demo React component library (12 components + tokens)
scripts/         headless runner, scripted e2e, prototype verifier, smoke test
test/            unit tests, VS Code extension-host tests, fixtures
docs/            PLAN.md, ADRs
```
