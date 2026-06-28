---
id: lsn_sticky_scroll_scene_progress_not_position
title: "Drive a tall sticky scroll-section from scroll PROGRESS, not item positions — bottom items sit in a dead zone"
type: workflow_best_practice
tier: community
summary: "Vercel/Apple-style sticky section: a tall element pins while a column scrolls past and scenes switch per item. Position-based scrollspy never reaches the last items — the element unpins before bottom items cross the detection line, and a last-item rescue skips the one before it. Fix: map scenes to equal bands of the pinned scroll PROGRESS. Caveat: bands couple to element height, so changing it shifts switches (reads 'early down, late up') — correct with a fixed pixel offset."
context:
  tags:
    - scroll
    - sticky
    - scrollspy
    - animation
    - motion-design
    - ux
  languages:
    - typescript
    - css
  platforms:
    - web
  tools: []
---

## The setup

A Vercel/Apple-style section: a tall element (editor mockup, image, card) is
`position: sticky` and pins while a column of items scrolls past it. As each
item reaches the pinned element you switch its content ("scene").

## The trap: position-based scrollspy can't reach the bottom items

If you pick the active scene by "which item's centre/top is level with the
pinned element", the LAST item(s) never activate automatically. The element
unpins when the container bottom reaches it (`container.bottom ≈ stickyTop +
elementHeight`). Items within ~`elementHeight` of the container bottom are still
below the detection line at that moment → they never cross it while pinned. The
taller the sticky element, the bigger this dead zone. A "rescue" that
force-activates the last item at the element's bottom edge tends to fire BEFORE
the second-to-last item's turn → that one gets skipped entirely.

## The fix: map scenes to pinned-scroll PROGRESS, in equal bands

Compute progress `p` over the sticky travel and slice it into equal bands
(optionally a small prefix band for an intro/default scene):

```ts
const travel = containerHeight - elementHeight;            // sticky travel distance
const p = clamp((STICKY_TOP - containerTop) / travel, 0, 1);
const t = (p - INTRO_BAND) / (1 - INTRO_BAND);
const idx = clamp(Math.floor(t * SCENES.length), 0, SCENES.length - 1);
```

Every scene — including the last — gets an equal, guaranteed slice of scroll,
regardless of where its item physically sits. You trade exact "item is level
with the element" alignment (impossible for the tail anyway) for reliable, even
coverage.

## Caveat: the bands are coupled to the element height

`travel` and the element's centre both depend on the sticky element's height, so
changing that height shifts where each band triggers relative to the items. The
tell-tale is asymmetric: switches feel "a touch early scrolling down and late
scrolling up" — a fixed scroll threshold sitting slightly before the
visually-expected point reads exactly that way (you reach it early going down;
going up you must pass back over the item to re-reach it). Correct with one
constant pixel offset that delays every switch:

```ts
const p = clamp((STICKY_TOP - containerTop - SWITCH_OFFSET_PX) / travel, 0, 1);
```

## When this does NOT apply

- **Short sticky element** (≪ item spacing): position-based scrollspy reaches
  every item — use it for exact alignment.
- **No per-item scenes** (a single pinned graphic): no detection needed.
- **reduced-motion:** keep the scene switch (a state change, not a loop) but
  drop the cross-fade.

## Related

- `lsn_css_grid_sticky_needs_stretch_cell` — making the pin work at all first.
- `lsn_screenshot_calibrate_visual_geometry` — calibrate `SWITCH_OFFSET_PX` by
  screenshotting, not blind tuning.
- `search_lessons({ query: "sticky scroll last item never triggers", platforms: ["web"] })`
