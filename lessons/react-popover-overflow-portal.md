---
id: lsn_react_popover_overflow_portal
title: "Fix a popover clipped by an overflow container — portal to body + position:fixed from the anchor rect"
type: debugging_lesson
tier: community
summary: "A hover/click popover rendered inside a scrollable or overflow-hidden ancestor is clipped at the container edge; position:absolute on the trigger cannot escape it. Render through a portal to document.body and position it fixed from the trigger's getBoundingClientRect(), clamped to the viewport, flipping via a bottom-anchor. No positioning library needed."
context:
  tools: []
  languages:
    - typescript
  platforms:
    - web
  tags:
    - react
    - popover
    - tooltip
    - overflow
    - portal
    - positioning
---

## Symptom

A custom tooltip/popover (no positioning library) renders fine in isolation but is
visually cut off the moment its trigger lives inside an ancestor with `overflow: hidden`,
`overflow-x: auto`, or `overflow-y: auto`. A horizontal scroll container (e.g. a wide
chart/timeline) is the classic case: the popover cannot escape the clip rect, and
`position: absolute` relative to the trigger does not help because the clip happens on an
ancestor, not on the trigger.

Gotcha: a parent that sets only `overflow-x` (e.g. Tailwind `overflow-x-auto`) makes the
browser compute `overflow-y` to `auto` as well — so a popover placed *above/below* the
trigger is clipped vertically too, not just horizontally.

## Fix: portal + fixed + rect math

Render the popover through a portal to `document.body` so no ancestor can clip it, then
position it with `position: fixed` computed from the trigger's bounding rect:

```tsx
const rect = triggerEl.getBoundingClientRect();
const MARGIN = 8;
const HALF_W = CARD_WIDTH / 2; // fixed card width → clamp without measuring
// Horizontal: centre on the trigger, clamp so the card stays on-screen.
const center = rect.left + rect.width / 2;
const left = Math.min(
  Math.max(center, MARGIN + HALF_W),
  window.innerWidth - MARGIN - HALF_W,
);
// Vertical: place on whichever side has more room; cap height to that space.
const above = rect.top;
const below = window.innerHeight - rect.bottom;
const style =
  above >= below
    ? { left, bottom: window.innerHeight - rect.top + 8, maxHeight: above - 16 }
    : { left, top: rect.bottom + 8, maxHeight: below - 16 };

return createPortal(
  <div style={{ position: "fixed", transform: "translateX(-50%)", ...style }} />,
  document.body,
);
```

Three details that matter:

- **Clamp X to `[MARGIN + halfWidth, innerWidth − MARGIN − halfWidth]`.** This is what
  keeps a trigger near the right edge from pushing the card off-screen. A fixed card width
  lets you clamp without measuring the card first.
- **Flip by anchoring `bottom`, not `top`.** For the "above" placement, set
  `bottom: innerHeight − rect.top + gap`. You then do not need the card's height (which you
  do not know before render); `maxHeight = availableSpace` keeps it inside the viewport.
- **Close on `scroll`/`resize`.** A `fixed` card positioned from a one-time rect goes stale
  the instant the page scrolls. Either reposition on scroll, or — simpler for a transient
  popover — just close it. Register the scroll listener in capture mode
  (`addEventListener("scroll", close, true)`) so nested scroll containers fire it too.

## Why not `position: absolute` on the trigger

`absolute` is relative to the nearest positioned ancestor — usually *inside* the same
overflow container that clips you, so it inherits the clip. The portal moves the DOM node
out of that subtree entirely; `fixed` + viewport coordinates then sidestep every ancestor
`overflow` and `transform`.

## When this does NOT apply

If no ancestor clips (no `overflow` other than `visible`) and the trigger cannot sit near a
viewport edge, a plain in-flow absolutely-positioned tooltip is fine. The portal machinery
is specifically for the clip-and-edge cases. For production apps with many floating
elements, a positioning library (Floating UI, Radix) earns its keep over hand-rolled rect
math.
