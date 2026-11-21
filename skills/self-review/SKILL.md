---
name: self-review
description: Checking your own prototype in a real browser before handing it over. Screenshot every screen, walk every click path in the plan, compare against the Figma frame, fix what is off, and report honestly what is still off.
---

# Self-review

A prototype that compiles can still be wrong. A tab can do nothing, a modal
can open off-screen, a form can be cut off, or the colours can drift from the
Figma frame. The designer will find these in the first ten seconds, in front of
a stakeholder if you are unlucky. Self-review is you finding them first. The
harness reminds you to review once checks pass, and gives you a review browser
through the `playwright__*` tools.

## Before you start

- Type check and lint must already pass. Reviewing a broken build wastes a round.
- Make sure the dev server is running (`run_command dev_server` returns its URL)
  and use exactly that URL. Routes are hash routes:
  `<url>#/settings/notifications`.
- Have the plan in front of you: its screens and its flow are your test script.

## Tools, in the order you will use them

- `playwright__browser_navigate` with `url`: open a screen by its route.
- `playwright__browser_snapshot`: an accessibility snapshot of the page. It is the
  most reliable way to check structure and text, and it gives you element
  references for clicking. Always take a fresh snapshot before clicking,
  because references go stale after the page changes.
- `playwright__browser_click`: click using the reference from the snapshot (pass it as
  the target the tool's schema asks for) plus a short human description in
  `element`, e.g. "Notifications tab". The description is shown to the designer.
- `playwright__browser_type` / `browser_fill_form`: type into fields to test forms.
- `playwright__browser_take_screenshot`: what it actually looks like. Use it for
  layout, spacing and visual comparison.
- `playwright__browser_console_messages`: runtime errors the type check
  cannot see.
- `playwright__browser_resize`: only if the brief mentions mobile or responsive.

## The review, step by step

1. **Every screen renders.** For each route in the plan: navigate, take a snapshot,
   take a screenshot. Check that the heading and key content from the plan are present,
   nothing is blank, there is no error overlay, and nothing is clipped off-screen.
2. **Every click path works.** For each step in the plan's flow: start at
   `from`, perform the `action` by clicking or typing, and confirm you arrive at `to`.
   Check the URL (the snapshot shows it) and the visible content. Walk back
   too, because designers always try it. Each edge case listed in the flow (an
   empty field on Save, a cancelled modal) is also a path.
3. **Console is clean.** Check console messages once per screen. React warnings
   about keys or controlled inputs count as bugs.
4. **Matches the Figma frame (if there is one).** Compare your screenshot against the
   `figma__get_screenshot` image. Judge it the way the designer will:
   - Do structure and hierarchy match: same sections, same order, same primary action?
   - Do density and spacing feel the same? Allow token-scale rounding.
   - Do text and data shapes match: field labels, column headers?
   - Are differences caused by *missing components*? Those are expected. Make
     sure each one is in the missing-components list, not "fixed" with custom CSS.
   Pixel differences from the library's real styling are not bugs. The library
   is the source of truth, and that is the point of the harness.
5. **Triage what you found.**
   - *Broken*: a dead click, a wrong route, a crash, unreadable or overlapping
     text. Always fix these.
   - *Off-plan*: a missing screen, state or field from the plan. Fix it.
   - *Visual drift*: wrong spacing token, wrong variant, mismatched hierarchy.
     Fix it if a catalogue prop or token corrects it, otherwise note it.
   - *Library limits*: drift caused by a missing component. Record it, don't fix it.

## Rounds and stopping

One round is: review the affected screens → fix → re-check (typecheck/lint) →
re-review only what changed. The harness tells you the round limit (usually 3).
Stop when everything passes or you reach the limit. Don't spend a fourth
round on a cosmetic nit. The designer would rather get the prototype now with a
note.

On follow-up feedback, review only the screens and paths the change touched,
plus one quick pass of the landing screen.

## Reporting

End with a short, honest report for the designer, in design language:

- what you checked ("I clicked through both tabs and tried saving with an empty name")
- what you fixed during review ("the Save button was below the fold, so I moved it into the card footer")
- **what is still off** and why ("the avatar upload is a placeholder, because the library has no uploader")
- if the review browser was unavailable: "I couldn't run the visual check this time, but the type and lint checks pass."

Never claim a path works if you didn't walk it.

## Worked example

Prototype: Settings with Profile and Notifications tabs, at `http://127.0.0.1:5180/`.

1. Navigate `…/#/settings/profile`. The snapshot shows heading "Settings", the tablist
   with "Profile" selected, the fields Full name, Email, Role, Time zone and Bio, and the button
   "Save changes". The screenshot looks right.
2. Path "Profile → clicks Notifications tab → Notifications": fresh snapshot,
   click the "Notifications" tab. The URL is now `#/settings/notifications`, the tab
   is selected and three switches are visible. Path passes.
3. Path back: click "Profile". The URL returns to `#/settings/profile` and the field values are
   kept. Passes.
4. Path "clears Name and saves": type an empty Full name, click "Save changes".
   The snapshot shows no error. This is **broken**: validation is missing. Fix it in
   `parts/ProfileTab.tsx` with `error` on the TextField, re-run the type check,
   re-walk this path, and it now passes.
5. Toggle "Product updates" on Notifications. The switch flips. Passes. The console is clean.
6. Report:
   - "Both tabs work, with their own links, and back/forward works."
   - "Saving with an empty name now shows an error. I fixed that during review."
   - "Still off: the photo upload is a placeholder, because the library has no uploader. It's in the missing components list."
