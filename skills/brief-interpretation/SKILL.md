---
name: brief-interpretation
description: Turning a designer's rough brief, optionally with a Figma frame, into a screen list, a click flow and the one question worth asking, before anything is built.
---

# Brief interpretation

A brief from a designer is a description of an experience, not a specification.
"A settings page with a profile form and a notifications tab" names the
destination, but the questions that decide the build are left open: how many
screens is that, how does the user move between them, and what happens when
they press Save. Your job in this step is to turn the brief into a **plan**
the designer can confirm in ten seconds: screens, routes, the click flow,
components, gaps and assumptions. Do this before a single file exists.

Why plan first: rebuilding a prototype because "tabs" meant something
different to you than to the designer costs minutes of their attention. A plan
card costs one glance. The harness enforces this. `write_file` stays locked
until a plan is approved through `ask_user`.

## 1. Read everything you were given

1. **The words.** Underline the nouns (screens, objects, data) and the verbs
   (what the user does). Nouns become screens and components. Verbs become the
   click flow.
2. **The Figma frame, if linked.** The harness gives you `fileKey` and `nodeId`.
   Use the figma tools in this order, because each step narrows the next:
   - `figma__get_metadata`: the frame's layer tree, names and sizes. This tells you
     how many distinct screens or states the frame contains, and how they are named.
   - `figma__get_design_context` for the frame (or each screen-sized child).
     It gives you structure and the names of the Figma components used. Treat its code
     output as a *reference for layout and hierarchy*. Never paste it: you rebuild
     everything from catalogue components.
   - `figma__get_variable_defs`: colours, spacing and type used. Map these onto the
     team's tokens. You do not copy hex values.
   - `figma__get_screenshot`: keep it. Self-review compares against it later.
   If Figma is not connected, say so in one sentence in the plan's assumptions
   ("I couldn't open the Figma link, so this plan is from your description") and
   continue from the text.
3. **The catalogue.** Skim the component summary in your instructions. Knowing
   that the library has `Tabs` but no `Sidebar` changes the plan, for example
   tabs across the top rather than a left nav. Record it as a gap.

## 2. Decide the screens

A **screen** is anything with its own URL. Make something a screen when a
stakeholder might want to link to it, or it would get its own URL in the real
product:

- Tabs of a settings page: **each tab is a route** (`/settings/profile`,
  `/settings/notifications`). Tabs that are only component state cannot be
  deep-linked, cannot be opened by self-review, and lose their place on reload.
- A confirmation or a small edit is **not** a screen. It is a modal or an inline
  state on the screen that triggers it.
- Empty, loading and error states are states of a screen, not screens. Include
  them only when the brief mentions them or when the screen is meaningless
  without them (a search results page needs "no results").

Keep it small. Build the flows the brief describes. A prototype is for testing
an idea, and every extra screen is something stakeholders will comment on that
nobody asked about.

## 3. Write the click flow

List every transition as `from → action → to`. Each one becomes a path that
self-review walks later, so make the actions concrete: "clicks the
Notifications tab", not "navigates". Include the way *back*: the
designer will try it.

## 4. Ask one question, or none

Ask only when two reasonable readings of the brief lead to **different
builds**, and the brief gives no hint. Good questions change structure:

- modal or new page ("Edit profile": in place or a separate screen?)
- one long form or a multi-step wizard
- a list with a detail page, or a list with an inline expanded row

Bad questions are ones you can answer with a sensible default and mention as an
assumption: copy, colours, the exact fields, how many rows of mock data.

When you ask, use `ask_user` with 2-4 short options, and say what each one means
for the experience, not for the code. The harness allows only one clarifying
question per request. Every other open point becomes an assumption in the plan.

## 5. Present the plan

Call `ask_user` with `question: "Shall I build this?"` and a `plan`:

- `prototypeName`: short kebab-case (`account-settings`)
- `summary`: one or two plain sentences
- `screens`: id, name, route, purpose, and the catalogue components used
- `flow`: the transitions from step 3
- `missingComponents`: from the component-mapping skill (need, using instead, why)
- `assumptions`: every decision you made on their behalf

If they ask for changes, revise and present again. Once approved, build exactly
the approved plan. If you discover mid-build that the plan cannot work, say why
and show the corrected plan rather than silently diverging.

## Follow-up feedback

"Make the table denser" or "add an empty state" changes an existing prototype.
Do not re-plan. Map the feedback to the screens it touches, make the change,
and re-check. Show an updated plan only if screens are added or removed.

## Worked example

**Brief:** "a settings page with a profile form and a notifications tab"

Nouns: settings page, profile form, notifications. Verbs: edit profile, save,
switch tab, toggle notifications. Library check: `Tabs`, `TextField`, `Select`,
`Switch`, `Card`, `Avatar`, `Button`, `Alert` exist. No avatar uploader.

Ambiguity check: should Save on the profile form be per-form or global? Both
readings give nearly the same build, so this is an assumption, not a question. Do
notifications save instantly? The library's `Switch` is documented as "settings
that apply immediately", so yes, with no Save button. Another assumption, no
question.

Plan:

- `prototypeName`: `settings`
- Screens:
  - **Profile**, `/settings/profile`: edit name, email, role, time zone and bio,
    then save. Uses Tabs, Card, Avatar, TextField, Select, Button, Alert.
  - **Notifications**, `/settings/notifications`: turn email/push/digest
    notifications on and off. Uses Tabs, Card, Switch, Text.
- Flow:
  - Profile → clicks “Notifications” tab → Notifications
  - Notifications → clicks “Profile” tab → Profile
  - Profile → edits a field and clicks “Save changes” → Profile with the success alert
  - Profile → clears Name and clicks “Save changes” → Profile with a field error
- Missing components:
  - Avatar upload control → Avatar + secondary Button “Change photo” (non-functional) →
    the library has a display-only Avatar and no file picker.
- Assumptions:
  - `/settings` opens the Profile tab.
  - Notification switches apply instantly (no Save), per the Switch guidelines.
  - Saving shows an inline success message, with no real network call.

That is one glance for the designer, and every line maps to something
buildable and checkable.
