---
id: lsn_animated_disclosure_grid_rows_inert
title: "Animate a collapse with grid-template-rows 0fr↔1fr — and mark the collapsed region inert"
type: workflow_best_practice
tier: community
summary: "Animate a disclosure/accordion open+close without measuring height: transition one CSS grid row from 0fr to 1fr (inner element needs overflow:hidden). Gotcha: overflow:hidden + height 0 hides content visually only — collapsed links/buttons stay in the tab order and a11y tree, so keyboard and screen-reader users reach invisible controls. Fix: mark the collapsed region inert (React 19 has it as a prop) + aria-hidden, and gate the transition behind prefers-reduced-motion."
context:
  tools: [react, nextjs]
  languages: [typescript, css]
  platforms: [web]
  tags: [accessibility, css, animation, disclosure, accordion, inert, react]
last_validated_at: "2026-07-14"
version: 1
---

## The pattern: animate height with grid-template-rows

To animate an accordion/disclosure open and closed **without measuring height** — the `max-height: 9999px` guess that makes the easing uneven and the timing wrong — wrap the collapsible content in a CSS grid whose single row animates between `0fr` and `1fr`:

```tsx
<div
  className={
    "grid transition-[grid-template-rows] duration-200 ease-out " +
    (open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")
  }
>
  <div className="overflow-hidden">
    {/* collapsible content */}
  </div>
</div>
```

The inner element **must** have `overflow: hidden`: a grid item's default `min-height: auto` otherwise refuses to shrink below its content, so the `0fr` track never actually reaches zero. This animates the real content height, needs no JS and no height measurement, and collapses to exactly 0.

## The gotcha: a visually-collapsed region is still keyboard-focusable

`overflow: hidden` with height 0 hides content **visually only**. The collapsed links and buttons stay in the **tab order** and the **accessibility tree** — so a keyboard user tabs into invisible controls and a screen reader announces them. The same trap applies to `max-height: 0` and to any collapse that leaves `visibility` at `visible`.

Remove the collapsed subtree from interaction with `inert` (which also drops it from the a11y tree), with `aria-hidden` as a belt-and-braces fallback for older assistive tech:

```tsx
<ul id="submenu" inert={!open} aria-hidden={!open} className="overflow-hidden">
  {/* … */}
</ul>
```

- **React 19** exposes `inert` as a first-class boolean prop — `inert={!open}` type-checks and renders the bare attribute.
- **React 18 / plain DOM**: set it imperatively — `el.toggleAttribute("inert", !open)` — and load the `inert` polyfill for browsers that predate native support.
- Wire the trigger button to the region with `aria-expanded={open}` + `aria-controls="submenu"` so the state is exposed, not just implied by the animation.

## Gate the animation behind reduced motion

The grid-rows transition is motion and must be gated: Tailwind `motion-reduce:transition-none`, or `@media (prefers-reduced-motion: reduce) { .disclosure { transition: none } }`. The open/closed state still flips instantly; only the animation is dropped.

## When this does NOT apply

- **Content removed from the DOM when closed** (conditional render / `display: none`): it is already out of the tab order and a11y tree, so `inert` is moot — but you also lose the exit animation, which is usually why you reached for grid-rows in the first place.
- **A fixed, known collapsed height** ("show first 2 lines"): a plain `height`/`max-height` transition to a concrete value is simpler and needs no grid.
- **Browsers without `grid-template-rows` interpolation** (pre-2023 Chromium/Firefox) snap instantly instead of animating — acceptable as progressive enhancement; otherwise animate `max-height` and keep the same `inert` discipline.

Retrieve before building: `search_lessons({ query: "animate collapse grid-template-rows inert accessibility", tools: ["react"] })`.
