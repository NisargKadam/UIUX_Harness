# UIUX Harness — build plan

## Goal

A VS Code extension that turns a designer's brief (optionally a Figma frame) into a
clickable prototype built from the team's real component library, shown in a live
preview inside VS Code. The designer, Ada, never needs to read code: she describes,
watches, and gives feedback in plain language.

## Shape of the system

```
┌──────────────── VS Code extension host ────────────────┐
│ Chat view (webview)   Activity view (tree)   Preview   │
│        │                     ▲              (webview   │
│        ▼                     │               panel,    │
│  ┌──────────── core (no vscode import) ───────┐ iframe)│
│  │ AgentLoop (Messages API, streaming)        │   ▲    │
│  │  ├─ built-in tools (6)                     │   │    │
│  │  │   read_file · write_file* · run_command*│───┘    │
│  │  │   get_diagnostics · preview · ask_user  │        │
│  │  ├─ skills (4 × SKILL.md) → system prompt  │        │
│  │  ├─ MCP manager → figma / catalogue /      │        │
│  │  │                playwright (each optional)│       │
│  │  └─ quality gates (type check, retries)    │        │
│  │ Framework adapter (react-vite)             │        │
│  └────────────────────────────────────────────┘        │
└────────────────────────────────────────────────────────┘
 * write_file is hard-limited to prototypes/<name>/ (path guard, tested)
 * run_command takes a command *name* (dev_server | typecheck | lint), never a string
```

`src/core` has no dependency on `vscode`, so the same loop runs from a headless
CLI (`scripts/run-headless.ts`). That is how the end-to-end check is run and how the
loop is debugged without an Extension Development Host.

## Decisions to record

- **Agent loop**: the Claude Agent SDK or a loop written directly on the Messages API. See `docs/adr/0001-agent-loop.md`.
- **Routing in prototypes**: a tiny hash router generated into the prototype. It needs no
  dependency, and the preview can deep-link (`#/settings/notifications`).
- **Base files are deterministic**: the adapter writes `index.html`, `main.tsx`,
  `vite.config.mjs` and `tsconfig.json`. The model writes screens, flow and mock data, so
  less of the build depends on model accuracy.
- **Catalogue as MCP**: the built-in indexer is exposed through an in-process MCP
  server, so the agent sees one interface whether it is backed by Storybook or by
  the indexer.

## Vertical slices

1. **Text brief → running prototype.** Extension skeleton, chat view, agent loop,
   read/write/run-command tools, path guard + command allowlist, built-in catalogue
   indexer, scaffolding + component-mapping skills, React/Vite adapter, sample
   workspace with 12 components and tokens. Unit tests for guard/allowlist/indexer.
2. **Preview + auto-fix.** Preview panel (webview, iframe to dev server), preview
   tool, diagnostics tool, code-enforced type-check gate with bounded retries.
3. **Self-review.** Playwright MCP connection, self-review skill, review-round limit
   and "what's still off" report.
4. **Figma.** Figma MCP connection, Figma URL parsing, brief-interpretation skill,
   plan-before-build with one clarifying question.
5. **Storybook + polish.** Storybook MCP catalogue source, activity view in designer
   language, diffs hidden behind a toggle, README and walkthrough.

Each slice ends with a commit on `feat/uiux-harness`. A PR to `main` follows slice 5.

## Definition of done

- Unit tests pass for the write-path guard, the command allowlist and the indexer.
- E2E: the brief "a settings page with a profile form and a notifications tab"
  produces a prototype in `sample-workspace/` that type-checks, builds and renders,
  with working tab navigation (checked by Playwright).
- README: install, configuration, the three MCP setups, a five-minute walkthrough.
- No secrets in the repo. `.gitignore` covers node_modules, build output and `.env`.
