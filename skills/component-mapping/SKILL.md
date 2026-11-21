---
name: component-mapping
description: Mapping every UI element in the plan or Figma frame onto a real component from the team's catalogue, choosing props and tokens, and recording gaps as missing components instead of inventing new ones.
---

# Component mapping

The whole point of this harness is that **the prototype is made of what
engineering can ship**. A pixel-perfect prototype built from hand-rolled divs
misleads everyone. Stakeholders approve something that does not exist, and
engineers have to reverse-engineer it. A prototype that uses `<Button
variant="secondary">` where the design has a grey button tells the truth: this
is what the product will look like with the components we have.

So the rules below are strict. When a rule feels like it makes the prototype
look worse than the Figma frame, follow it anyway and record the gap. The
gap is valuable information for the design-system team.

## The rules

1. **Every visible element is a catalogue component or a composition of them.**
   Layout uses the layout primitive (e.g. `Stack`), text uses the typography
   primitive (e.g. `Text`), and surfaces use `Card`. A raw `<div>` is allowed only as
   an invisible grid or width wrapper styled with tokens, never to draw something
   (borders, backgrounds, pills, badges).
2. **Never invent a component.** Do not create `Badge.tsx` because the library
   lacks one, and do not restyle a `Button` into a chip. If nothing fits, use the
   **closest primitive** and add a missing-components entry: what was needed,
   what you used instead, and why nothing fits.
   *Why:* invented components look real in a demo and turn into surprise
   scope in the sprint.
3. **Check props before you use them.** Call `catalogue__get_component` for every
   component you have not used yet in this session. Use only props it lists,
   and literal values from its allowed values. Respect required props (for
   example a `label` on inputs, a `caption` on tables): they usually encode
   accessibility rules.
4. **Use the documented intent, not just the look.** Descriptions carry design
   guidance ("one primary button per view", "Switch for settings that apply
   immediately", "Modal for short tasks that should not lose the user's
   place"). When the brief or frame conflicts with that guidance, follow the
   guidance and note it in the plan's assumptions.
5. **Tokens, never raw values.** Spacing comes from the spacing scale (`gap={4}`
   on Stack, or `var(--space-4)`). Colours and type come from tokens. When a
   Figma variable has no exact token, use the nearest one. It is a gap only if
   the difference is visible and deliberate.
6. **Prototype-local compositions are fine.** A `SettingsLayout` that arranges a
   title, `Tabs` and content using `Stack` is good structure. Put it in
   `parts/`. It contains only catalogue components, plus layout `div`s
   styled with tokens.

## How to map

For each screen in the plan:

1. List its UI elements top to bottom: heading, nav, each field, each action,
   each list or table, and each feedback message.
2. For each element, pick in this order:
   - **exact match**: the catalogue has a component for this purpose
     (a text input → `TextField`)
   - **variant or prop**: an existing component covers it with a prop
     (a multi-line bio → `TextField multiline`)
   - **composition**: several components together (a profile header →
     `Stack direction="row"` + `Avatar` + `Text`)
   - **closest primitive + gap**: nothing fits (a date picker →
     `TextField type="text"` with placeholder "DD/MM/YYYY", recorded as missing)
3. Note the props that matter (variant, size, tone, density), so building is
   mechanical.

With a Figma frame, Figma component names are strong hints ("Button/Primary" →
`Button variant="primary"`), but the catalogue is the source of truth. A Figma
component with no catalogue counterpart is a gap, even if it looks simple.

## Writing a good missing-component entry

Each entry should help an engineer decide whether to build it:

- `need`: the pattern by its usual name ("Date picker", "Avatar uploader")
- `usingInstead`: exactly what the prototype uses
- `reason`: why the nearest candidates do not fit ("Select only allows one value
  from a list; this needs a calendar")
- `screens`: where it appears

Do not record gaps for things the library deliberately does not do in that way.
If the brief asks for a toast but the library's `Alert` says "not for transient
toasts", use an inline `Alert` and say so in the assumptions. Record a toast as a
gap only if the experience really depends on it.

## Worked example

Screen: **Profile** (`/settings/profile`) from "a settings page with a profile
form and a notifications tab", with the sample Acme library.

| Element | Component | Props / notes |
|---|---|---|
| Page title "Settings" | `Text` | `variant="title" as="h1"` |
| Section switcher | `Tabs` | `ariaLabel="Settings sections"`, items Profile/Notifications, `selectedId` from the route |
| Profile section surface | `Card` | `title="Profile" description="How others see you on Acme"`, footer holds the actions |
| Photo + name header | `Stack` row + `Avatar` + `Text` | `Avatar size="lg"` |
| "Change photo" | `Button` | `variant="secondary" size="sm"` (non-functional) → **gap**: avatar uploader |
| Full name, Email | `TextField` | `required`, `type="email"` for email, `error` on empty name |
| Role | `Select` | options from mock data |
| Time zone | `Select` | 6-8 realistic options |
| Bio | `TextField` | `multiline rows={4}` with `helperText` |
| Save changes / Cancel | `Button` | primary + ghost in `Card footer`. One primary per view |
| "Changes saved" | `Alert` | `tone="success"`, dismissible |

Missing components:

- **Avatar uploader**: using `Avatar` + secondary `Button` "Change photo".
  `Avatar` is display-only and the library has no file-input component.

Not a gap: the frame's grey section dividers. `Card` already separates
sections, so a hand-drawn divider would be invented UI.
