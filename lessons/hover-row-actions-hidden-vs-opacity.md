---
id: lsn_hover_row_actions_hidden_vs_opacity
title: "Hide hover-revealed row actions with display:none, not opacity-0 — unless the row has nothing else to focus"
type: workflow_best_practice
tier: community
summary: "Hover-revealed row actions hidden with `opacity-0` still take their full width on every row (titles truncate, metadata wraps in narrow lists) and stay invisible yet tappable on touch. Hide them with `display:none`, revealed on hover, `:focus-within` and `(hover: none)`. That stays keyboard-reachable only if the row has another focusable element; a header whose only focusables are the actions must keep `opacity`."
context:
  languages: [typescript, css]
  platforms: [web, tailwind]
  tags: [css, tailwind, hover, accessibility, keyboard, touch, layout, ux]
last_validated_at: "2026-10-14"
---

## Symptom

A list in a narrow container (a side panel, a drawer) shows each row as a
title, a metadata line ("2 h ago · deletes in 90 days") and a cluster of icon
buttons that appear on hover:

```tsx
<div className="group/row flex items-start gap-1">
  <button className="min-w-0 flex-1 text-left">
    <span className="block truncate">{title}</span>
    <span className="block text-xs">{meta}</span>
  </button>
  <span className="flex gap-0.5 opacity-0 group-hover/row:opacity-100">
    {/* 3–4 × 20 px icon buttons */}
  </span>
</div>
```

Three things go wrong, and none of them shows up in a type check or a build:

1. **Every row loses the actions' width, all the time.** `opacity: 0` hides
   paint, not layout. Four 20 px buttons cost ~80 px on every row, hovered or
   not. In a 250 px panel the title truncates at half its room and the
   metadata line wraps onto a second line ("deletes in 90 / days") — the list
   looks broken at rest, which is when it is looked at most.
2. **Touch devices never see them.** There is no hover, so the buttons stay
   transparent — yet still tappable, so a tap near the right edge fires an
   invisible "Delete".
3. **The obvious fix can lock out keyboard users.** Switching to
   `hidden group-hover:flex` removes the buttons from the tab order while
   hidden. Whether they can still be reached depends on what else the row
   contains.

## The pattern

Hide with `display:none`, and reveal on every way a user can "be at" the row:

```tsx
<span
  className={
    "shrink-0 items-center gap-0.5 " +
    (pinnedOpen // a confirm step or an open sub-panel keeps them shown
      ? "flex"
      : "hidden group-hover/row:flex group-focus-within/row:flex [@media(hover:none)]:flex")
  }
>
```

- `group-hover/row:flex` — mouse.
- `group-focus-within/row:flex` — keyboard. This works **only because the row
  has another focusable element** (the row's own open-button). Tabbing onto it
  sets `:focus-within` on the row, the actions become `display:flex`, and the
  next Tab lands on the first action. Verified in Chrome: focus on the row
  button → actions `display: flex`; Tab → focus on "Pin …".
- `[@media(hover:none)]:flex` — touch: always visible, because there is no
  other way to reveal them. (Gate on the input capability, not the viewport
  width — see the related convention below.)
- Keep them visible while an interaction is in progress (an inline
  "Really?" confirm, a picker opened from one of the buttons); otherwise moving
  the pointer away hides the control the user is about to press.

At rest the text gets the full width; on hover the title truncates a little,
which is the trade the design accepted anyway.

## When to keep `opacity-0` instead

If the container has **no focusable element besides the actions** — a section
header with "Rename" and "Delete", a card whose body is not interactive —
`display:none` makes the actions unreachable by keyboard: there is nothing to
tab onto that would trigger `:focus-within`, and hidden elements are skipped.
Keep the opacity approach there; the buttons stay in the tab order, and
focusing one reveals the group:

```tsx
"flex items-center gap-1.5 transition " +
(confirming
  ? "opacity-100"
  : "opacity-0 group-hover/head:opacity-100 group-focus-within/head:opacity-100 [@media(hover:none)]:opacity-100")
```

The width cost is acceptable there because a header has room (a single short
label, not a title plus metadata). Decide per container with one question:
**is there something else in this box a keyboard user can focus first?** Yes →
`display:none`. No → `opacity`.

## Verification

Headless checks catch all three failure modes; a screenshot alone catches only
the first.

```js
// 1) at rest: no width taken
getComputedStyle(row.querySelector(".actions")).display === "none";
// 2) keyboard: focus the row's own button, then Tab
rowButton.focus();     // → actions display: "flex"
// press Tab           // → document.activeElement is the first action
// 3) touch: emulate a touch device from the start (Puppeteer)
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
matchMedia("(hover: none)").matches; // true → actions display: "flex"
```

Two harness traps met while verifying:

- Switching an existing page to `isMobile: true` with `setViewport` reloads it,
  so open dialogs and panels are gone. Start a separate page as mobile from
  the beginning.
- A plain narrow viewport does **not** emulate `(hover: none)`; without
  `hasTouch`/`isMobile` the touch branch is never exercised, and the check
  reports the desktop result.

## When this does NOT apply

- **Actions that must stay discoverable at rest** (a primary action per row):
  show them always; hover-reveal is for secondary actions only.
- **Wide rows with spare room**: the width cost of `opacity-0` is invisible,
  and the keyboard behaviour is already fine — no reason to change.
- **Actions in a popover/menu opened by a visible "⋯" button**: only that one
  button needs a policy; the menu itself is click-toggled and has its own
  focus management.

## Related

- [[lsn_hover_reveal_hit_zone_leave_delay]] — the other half of hover-revealed
  controls: keeping them open while the pointer travels to them.
- [[lsn_touch_detection_pointer_media_not_viewport_width]] — why the touch
  branch keys on `(hover: none)` / `(pointer: coarse)` and not on a width
  breakpoint.

Retrieve before building a list with hover actions:

```js
search_lessons({ query: "hover row actions opacity-0 hidden keyboard touch", tags: ["hover", "accessibility"] })
```
