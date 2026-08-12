---
id: lsn_container_query_traps_inline_fixed_overlays
title: "Before adopting `container-type`, audit for inline `fixed` overlays — containment silently traps them"
type: workflow_best_practice
tier: community
summary: "`container-type: inline-size` implies `contain: layout`, which makes the element a containing block for every `position: fixed` descendant — so adding a container query to a page wrapper silently re-anchors inline-rendered full-screen modals to that wrapper instead of the viewport. Audit for un-portalled `fixed inset-0` first. Where the viewport-to-container offset is constant (fixed sidebar + padding), a media query at `threshold + offset` is exactly equivalent."
context:
  languages:
    - css
    - typescript
  platforms:
    - web
  tags:
    - css
    - container-queries
    - containment
    - position-fixed
    - responsive
    - layout
---

## The decision this is about

You have a nested-layout bug: an inner two-column split fires on a `lg:` breakpoint,
but the actual available width is much smaller than the viewport because a fixed
sidebar, page padding and a widget rail sit in between. The textbook answer is
container queries — the breakpoint should ask "how wide am I?", not "how wide is the
window?". That reasoning is correct.

The trap is what `container-type` does on the way in.

## Why containment is not free

`container-type: inline-size` (and `size`) computes to `contain: layout style inline-size`.
And `contain: layout` **makes the element a containing block for absolutely and
fixed positioned descendants**.

So the moment you write

```css
.content-column { container-type: inline-size; }
```

every `position: fixed` element rendered *inside* that column stops being positioned
against the viewport and is positioned against the column instead. A full-screen
modal overlay becomes a column-shaped overlay.

Nothing errors. The build passes, types pass, the container query works exactly as
intended. The regression shows up only when someone opens a dialog on a page inside
that subtree.

## The audit, before you add the container

Full-screen overlays are usually written inline, right where the trigger lives —
that is the default shape of a dialog in most React codebases, and it is fine until
containment appears above it.

```bash
# Overlays that will be trapped: full-screen fixed, not rendered through a portal
rg -l 'fixed inset-0' src
rg -l 'createPortal' src
```

If the first list is materially longer than the second, adopting container queries on
a shared wrapper is a breaking change disguised as a layout refactor. In one Next.js
dashboard the counts were 21 vs 4 — meaning 17 dialogs would have been re-anchored by
a one-line CSS addition.

Two ways forward:

1. **Portal the overlays first**, then adopt the container. This is the right end
   state anyway — see [[lsn_fixed_modal_zindex_trapped_by_stacking_context]] for why
   inline `fixed inset-0` is fragile for an independent reason (stacking contexts),
   and [[lsn_backdrop_filter_containing_block]] for the same trap sprung by
   `backdrop-filter`.
2. **Scope the container to a subtree that provably holds no overlays** — a chart
   wrapper, a card body — rather than the page-level content column.

## When a media query is exactly equivalent (and cheaper)

Container queries are the right tool when the offset between viewport and container is
*variable*. When it is a **constant**, a media query computes the same condition:

```
container_width = viewport − chrome
```

If the chrome is a fixed-width sidebar plus fixed padding above some breakpoint, it is
a constant in that range, so

```css
/* Rail beside content only when both fit at full width:
 *   19rem chrome (15rem sidebar + 4rem padding)
 * + 18rem rail + 1.5rem gap + 49rem content floor
 * = 87.5rem ≈ 1400px
 */
@media (min-width: 1400px) { … }
```

is equivalent to `@container (min-width: 68.5rem)` — without any containment.

Write the arithmetic into a comment next to the number. The value is derived, not
chosen, and the next person changing the sidebar width has to redo the derivation.

Note the asymmetry that makes this workable: container queries accept `calc()` in the
condition, media queries do not — but neither accepts a `var()`, so a per-tier
threshold ends up hand-computed either way.

## When this does NOT apply

- **Your overlays already portal to `document.body`.** Then containment cannot reach
  them and container queries are simply the better tool — use them.
- **The offset is genuinely variable** (a resizable or collapsible sidebar, a
  container nested at unpredictable depth, a component shipped into unknown layouts).
  A media query cannot express that; take the container and portal the overlays.
- **You need `container-type: normal`** (style queries / `cqi` units only, no size
  containment) — that does not imply `contain: layout` and springs no trap.

## Verification

After adding any `container-type`, open a dialog on a page inside that subtree and
confirm the overlay still covers the viewport — not just the column. A build or
typecheck cannot catch this; it is a positioning change, not a type error.

Related reading, and the two lessons this one hands off to:

```
search_lessons({ query: "container-type contain layout traps position fixed modal", platforms: ["web"] })
get_lesson({ id: "lsn_fixed_modal_zindex_trapped_by_stacking_context" })
```
