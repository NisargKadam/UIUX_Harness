---
name: prototype-scaffolding
description: Writing the approved plan as a working prototype in prototypes/<name>/, with routes for every screen, realistic mock data, believable interactions, and code that passes the type check first time.
---

# Prototype scaffolding

A prototype has one job: let someone click through the experience and believe
it. It does not need a backend, tests or abstractions. It needs every screen
reachable, every button doing *something* plausible, and data that looks real.
It also has to compile cleanly, because a blank preview is the worst possible
demo.

## What already exists

When the plan is approved, the harness writes the plumbing for you: `index.html`,
`main.tsx` (renders `App` and imports the token styles), `router.tsx`, the
bundler config and `tsconfig.json`. Never rewrite the plumbing: config files
are locked for writing because the dev server executes them. If something in
the plumbing seems wrong, say so in your report instead of working around it.

## File layout

```
prototypes/<name>/
  App.tsx              routes and app-level state. Must `export function App()`
  screens/
    ProfileScreen.tsx  one file per screen, named <Name>Screen
  parts/               optional: compositions of catalogue components
  mock/data.ts         all mock data, typed
  prototype.css        optional: page layout only, tokens only
  MISSING_COMPONENTS.md  written by the harness from the plan; keep it current
```

Why this shape: the designer (and an engineer later) can find a screen by its
name, mock data is in one place to tweak before a stakeholder session, and
the app state in `App.tsx` makes cross-screen behaviour obvious.

## Routing

Use the router the harness wrote (`./router`): `Router`, `navigate`, `Link`,
`Redirect`, `usePath`, `matchPath`. Every screen in the plan gets the route from the plan.

- Tabs and sub-sections are routes (`/settings/:tab`). The selected tab comes
  **from the URL**, and changing the tab calls `navigate(...)`. That way the browser
  back button works, self-review can open each tab directly, and a reload keeps
  the user's place.
- Unknown routes fall back to the first route, so the preview never shows a
  blank page. Put the landing screen first.
- Use `navigate()` in event handlers (buttons that move between screens),
  `<Link>` for text links, and `<Redirect to="…" />` to send an invalid route
  somewhere valid. Never call `navigate()` during render: it fires before the
  router is listening, and the page stays blank.

## State and mock data

- Keep data that crosses screens in `App.tsx` with `useState`, and pass values and
  callbacks down. Use no state libraries and no context unless several screens share it.
- Form state lives in the screen. Forms are **controlled** (`value` + `onChange`),
  as the catalogue's inputs require.
- Mock data in `mock/data.ts` is typed and realistic: real-sounding names,
  plausible emails (`ada.lovelace@acme.example`), dates in the recent past, and
  amounts with cents. Do not use "Lorem ipsum", "Test User" or "foo". Stakeholders
  react to fake-looking data instead of the design.
- No network calls, no timers longer than about 800 ms, and no `localStorage` unless
  asked. Fake latency only where the experience depends on it, such as a
  loading button on Save.

## Interactions must be believable

- **Save** validates the obvious things (required fields, email shape), shows
  field errors through the component's `error` prop, and on success shows
  feedback (e.g. an `Alert tone="success"`).
- **Destructive actions** confirm first, with a `Modal` if the library has one.
- **Toggles** that "apply immediately" update state at once, with no Save button.
- A control the plan marked as missing or non-functional (e.g. "Change photo")
  still responds: it does nothing harmful and can show a short inline note.
- Never leave a button without an `onClick` or an empty handler. To a person
  clicking through, a dead button looks like a broken prototype.

## Code that compiles first time

- TypeScript strict. Type props of local parts with an interface. Type mock data
  with interfaces and export both.
- Import components only from the catalogue import specifier (e.g. `"@ds"`), with
  the exact names and props from `catalogue__get_component`. Import hooks and types
  from `"react"`. No other packages exist.
- Use named exports (`export function ProfileScreen`), and import local files
  relatively without extensions (`./screens/ProfileScreen`).
- No unused variables or imports. The linter fails on them.
- Keep files small: one screen per file, roughly 200 lines or fewer. For changes to an
  existing file, use `write_file` with `edits` rather than rewriting it whole.

## Build order

1. `mock/data.ts`
2. `parts/` you need
3. each screen
4. `App.tsx` with the routes

This order means every import exists by the time `App.tsx` references it.
Then run `run_command dev_server`, then `preview open`, then
`run_command typecheck` and `run_command lint`. Fix everything reported in the
prototype before moving on to self-review.

## Worked example

Plan: Settings with Profile (`/settings/profile`) and Notifications
(`/settings/notifications`) tabs.

`App.tsx`:

```tsx
import { Redirect, Router } from "./router";
import { SettingsScreen, type SettingsTab } from "./screens/SettingsScreen";

const TABS: SettingsTab[] = ["profile", "notifications"];

export function App() {
  return (
    <Router
      routes={[
        { path: "/settings/profile", render: () => <SettingsScreen tab="profile" /> },
        {
          path: "/settings/:tab",
          render: ({ tab }) =>
            TABS.includes(tab as SettingsTab) ? <SettingsScreen tab={tab as SettingsTab} /> : <Redirect to="/settings/profile" />,
        },
      ]}
    />
  );
}
```

`screens/SettingsScreen.tsx` (excerpt):

```tsx
import { Stack, Tabs, Text } from "@ds";
import { navigate } from "../router";
import { ProfileTab } from "../parts/ProfileTab";
import { NotificationsTab } from "../parts/NotificationsTab";

export type SettingsTab = "profile" | "notifications";

export function SettingsScreen({ tab }: { tab: SettingsTab }) {
  return (
    <Stack gap={6} padding={7} className="page">
      <Text variant="title" as="h1">Settings</Text>
      <Tabs
        ariaLabel="Settings sections"
        items={[{ id: "profile", label: "Profile" }, { id: "notifications", label: "Notifications" }]}
        selectedId={tab}
        onChange={(id) => navigate(`/settings/${id}`)}
      >
        {tab === "profile" ? <ProfileTab /> : <NotificationsTab />}
      </Tabs>
    </Stack>
  );
}
```

Notice what the example does: the URL decides the tab, every import comes from the catalogue or
a local file, there is one primary action per view, and the content lives in small
parts that are easy to change on the next round of feedback.
