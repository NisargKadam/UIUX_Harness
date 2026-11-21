# ADR 0001 — Agent loop: Messages API, not the Claude Agent SDK

- Status: accepted
- Date: 2026-11-21

## Context

The harness needs an agent loop that streams model output into a chat view, calls
six built-in tools and tools from up to three MCP servers, loads four bundled
skills, and enforces two safety rules in code:

1. Writes land only inside `prototypes/<name>/`.
2. Commands come from a fixed allowlist (dev server, type check, lint).

It must run inside the VS Code extension host, which is Electron's Node runtime.
The brief asked for the Claude Agent SDK (TypeScript) if it runs cleanly there,
and the Messages API directly if it does not.

## What I checked

`@anthropic-ai/claude-agent-sdk@0.3.330`, installed and inspected on 2026-11-21:

- The JS package (5 MB) does not run the agent itself. `query()` **spawns the
  Claude Code runtime as a child process** (`spawn(...)` in `sdk.mjs`; options
  `pathToClaudeCodeExecutable` / `spawnClaudeCodeProcess`).
- That runtime ships as a per-platform optional dependency. The darwin-arm64
  package is **352 MB unpacked**, and there are eight platform variants.
- The SDK has built-in tools (Bash, Write, Edit, ...). They can be disabled with
  `tools` / `disallowedTools`, with permission decisions in `canUseTool`.
  Custom tools are in-process MCP servers (`createSdkMcpServer`).

## Decision

Implement the loop directly on the **Anthropic Messages API** with
`@anthropic-ai/sdk`. Use a manual streaming loop (`client.beta.messages.stream`
plus `finalMessage()`), not the beta Tool Runner.

## Reasons

- **Packaging.** An extension built on the Agent SDK has to ship a 352 MB native
  binary per platform, as eight platform-specific VSIX builds. The Messages API
  bundles into one platform-neutral VSIX of a few MB.
- **The safety rules sit in our process.** With a subprocess runtime, the write
  restriction depends on `canUseTool` callbacks and on correctly disabling every
  built-in tool that can touch disk, Bash included. A tool we never define cannot
  be called. In our own loop the model can only reach six tool functions plus MCP
  tools, and `write_file` runs the path guard every time. The guard is a pure
  function with unit tests.
- **VS Code-native tools.** Diagnostics (`vscode.languages.getDiagnostics`), the
  preview panel and the ask-user card are host APIs. An in-process loop calls them
  directly. With a subprocess they need a bridge through an SDK MCP server.
- **Designer-facing progress.** We want each step reported in plain language
  ("Checking the settings flow"). A manual loop sees every tool call before it
  runs, so it can label it, gate it, and count retries.
- **Quality gates in code.** When the model says it is done, the loop runs the
  type check itself. On failure it feeds the errors back, up to
  `uiuxHarness.maxFixAttempts`. The Tool Runner would need this bolted on through
  `setMessagesParams` between iterations. The manual loop expresses it directly.

## What we give up, and how we cover it

| Agent SDK feature | Replacement here |
|---|---|
| MCP client | `@modelcontextprotocol/sdk` v1 client (stdio + streamable HTTP), in `src/core/mcp/manager.ts`. The newer `@modelcontextprotocol/client` v2 line is stable now, and moving to it later only changes imports. |
| Skills loader | `src/core/skills/loader.ts` reads `skills/*/SKILL.md` (frontmatter + body), and a workspace `.uiux-harness/skills/` can override them |
| Context management | Server-side prompt caching (top-level `cache_control`). Large tool results are truncated before they enter history |
| Built-in file tools | Our own `read_file` / `write_file`, scoped on purpose |

## API usage notes (current as of this ADR)

- Model ID comes from `uiuxHarness.model`. The default is `claude-opus-5-5`.
- On Opus 5.5 thinking is always on, so we send no `thinking` parameter. Depth is
  set with `output_config.effort` from `uiuxHarness.effort` (default `high`;
  the model's own default is `medium`).
- `tool_choice` stays `auto`, because forced tool choice returns 400 on Opus 5.5.
  The system prompt steers tool use.
- Every client tool sets `eager_input_streaming: true`. Every input is validated
  with zod before it runs. We stop on `max_tokens` / `refusal` before running
  tools.
- Server-side refusal fallback (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`) is on by default and can be turned off with
  `uiuxHarness.refusalFallback`.
- History is append-only (full `response.content`, thinking blocks included),
  which preserved thinking requires.
- The API key lives in VS Code `SecretStorage` only. The headless CLI uses the
  SDK's default credential chain (`ANTHROPIC_API_KEY` etc.) and never writes it
  anywhere.

## Revisit if

The Agent SDK ships a pure-JS / in-process runtime, or VS Code ships a supported
way to share a Claude Code install with extensions. The loop sits behind
`AgentLoop`, so swapping it does not touch tools, skills, or UI.
