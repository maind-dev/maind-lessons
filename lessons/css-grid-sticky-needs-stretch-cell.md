---
id: lsn_css_grid_sticky_needs_stretch_cell
title: "Fix a position:sticky panel that won't pin inside CSS Grid — the cell must stretch (align-items:start breaks it)"
type: debugging_lesson
tier: community
summary: "In a two-column CSS Grid (or flex row), a position:sticky child only has room to travel if its cell stretches to the row height (the default align-items:stretch). Setting align-items:start shrinks the cell to the child's own height, so the sticky element hits its cell bottom immediately and scrolls away — the pin appears not to work. Put the sticky on a child of a stretched cell, OR make the grid item itself sticky with align-self:start; don't mix the two."
context:
  tags:
    - css
    - css-grid
    - flexbox
    - sticky
    - layout
  languages:
    - css
    - typescript
  platforms:
    - web
  tools: []
---

## The symptom

A classic two-column "sticky sidebar / pinned panel": scrolling content on the
left, a `position: sticky; top: …` element on the right, laid out with CSS Grid.
It refuses to pin — it just scrolls away with the content. No error, no warning.

## Why it happens

`position: sticky` travels only within its **containing block** (its parent).
In a grid, an item's height defaults to the row height (`align-items: stretch`),
so a stretched right cell is as tall as the taller left column — giving the
sticky child a long range to stick across.

Set `align-items: start` (or `align-self: start` on that cell) and the cell
shrinks to its content, i.e. to the sticky child's own height. Now the child's
containing block is no taller than the child itself → zero travel → it unsticks
at the first pixel and scrolls off. The element is "sticky" but has nowhere to
stick.

## Two correct shapes — don't mix them

**Pattern A — sticky CHILD inside a stretched cell (most common):** keep the
default `align-items: stretch`. The cell fills the row; the inner sticky child
travels the full column height.

```css
.grid { display: grid; grid-template-columns: 1fr minmax(0, 560px); }
/* align-items: stretch is the default — leave it */
.right-cell > .sticky-inner { position: sticky; top: 96px; }
```

**Pattern B — the grid ITEM itself is sticky:** here you *do* want
`align-items: start` / `align-self: start`, so the item is its own height and
can stick within the (taller) track.

```css
.grid { display: grid; align-items: start; }
.right-item { position: sticky; top: 96px; } /* the grid item IS the sticky element */
```

The bug is the mix: `align-items: start` **and** the sticky on an inner child.

## Also check

- No `overflow: hidden` / `overflow: clip` on any ancestor between the sticky
  element and the scroll root — that silently disables sticky regardless of the
  cell height.
- Use `minmax(0, …)` on grid columns so wide/monospace content can't blow out
  the track and shift the sticky column.

## When this does NOT apply

- **Single-column / no grid or flex parent:** sticky pins against the nearest
  scrolling ancestor; the cell-height issue is grid/flex-specific.
- **Pattern B by design:** if the sticky element *is* the grid item itself,
  `align-items: start` is correct, not a bug.
- Note the inverse for modals: `lsn_modal_vertical_centering_state_jump` uses
  `items-start` to FIX a flex-centered modal that jumps on height change — same
  property, opposite remedy. Grid sticky wants stretch; the modal wants start.

## Verification

Give the sticky element a temporary bright background and scroll: it should hold
at its offset until its (tall) cell's bottom passes. If it leaves immediately,
inspect the cell's computed height — if the cell is only as tall as the sticky
element, the cell isn't stretching, and `align-items`/`align-self` is the cause.
For geometry-precise tuning, screenshot rather than reason blindly
(`lsn_screenshot_calibrate_visual_geometry`).

Related: `search_lessons({ query: "position sticky not pinning grid", platforms: ["web"] })`.
