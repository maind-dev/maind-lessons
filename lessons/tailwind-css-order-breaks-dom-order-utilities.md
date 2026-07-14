---
id: lsn_tailwind_css_order_breaks_dom_order_utilities
title: "Fix misplaced dividers after a Tailwind `order` reorder — `order` doesn't move `divide-y`/`first:`/`last:`"
type: debugging_lesson
tier: community
summary: "Reordering flex/grid children responsively with Tailwind's `order` (order-first / md:order-none) moves them visually but not in the DOM, while divide-y/divide-x, first: and last: key off DOM order. After the reorder the hairline dividers and edge-padding land on the wrong items (divider above the visually-first row, first:pt-0 in the middle). Fix: set dividers/padding per VISUAL position (border-t … md:border-t-0, pt-0/pb-0) on the reordered breakpoint, or reorder the data array."
context:
  languages: [css, typescript]
  platforms: [tailwind, web]
  tags: [tailwind, css, flexbox, grid, order, responsive]
last_validated_at: "2026-06-21"
version: 1
---

## The symptom

You reorder flex/grid children responsively with Tailwind's `order` utilities — e.g. on mobile the 2nd column should come first:

```tsx
// mobile: item #1 (0-indexed) first; desktop: keep DOM order
<li className={i === 1 ? "order-first md:order-none" : ""}>…</li>
```

It reorders visually, but the **hairline dividers and edge-padding are now wrong**: a divider sits above the visually-first item, the visually-middle item has `first:pt-0` (no top padding), the visually-last has a divider below it.

## Why

`order` is a paint/layout reordering only — the DOM order is unchanged. But these Tailwind utilities all key off **DOM** order:

- `divide-y` / `divide-x` compile to `& > * + *` (adjacent-sibling) — DOM adjacency.
- `first:` / `last:` map to `:first-child` / `:last-child` — DOM position.

So `divide-y` still draws the top border on the DOM-2nd child even after `order` moved it to the visual top, and `first:pt-0` still hits the DOM-first child even when it's now in the middle. CSS sibling/position selectors have no concept of `order`.

## The fix

Set dividers and edge-padding **per visual position**, not via the DOM-based utilities. Drop `divide-*` / `first:` / `last:` for the reordered axis and assign explicitly:

```tsx
// SETUP (visual-first on mobile): no top border, pt-0
i === 1 ? "order-first pt-0 md:order-none"
// last visual item on mobile: top border + pb-0
: i === 2 ? "border-t border-[var(--hairline)] pb-0 md:border-t-0"
// middle: just a top border
:           "border-t border-[var(--hairline)] md:border-t-0"
```

Keep the DOM-based `md:divide-x` / `md:first:pl-0` for the breakpoint where DOM order == visual order (e.g. desktop), and only override on the breakpoint you reorder.

Alternative: reorder the **data array** so DOM order matches the most common visual order, and use `order` only for the other breakpoint — but you still hit the same divider problem on whichever breakpoint diverges, so per-visual-position styling is usually cleaner.

## When this does NOT apply

- No `order` reordering → `divide-*` / `first:` / `last:` are correct (DOM == visual).
- Reordering with actual DOM moves (two rendered lists toggled by breakpoint) keeps the utilities correct per list — at the cost of duplicated markup.

Retrieve before a responsive reorder: `search_lessons({ query: "tailwind order divide-y first last DOM order", tags: ["tailwind"] })`.
