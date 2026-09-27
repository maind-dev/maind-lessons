---
id: lsn_framer_motion_layout_spacer_flings_sibling_grid_placement
title: "Fix a framer-motion sibling that slides in from below — an empty `layout` spacer perturbs the FLIP projection"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript]
  platforms: [react, framer-motion]
  tags: [framer-motion, animation, layout, animatepresence, css-grid, carousel]
summary: "In an AnimatePresence (mode='popLayout') whose children carry `layout`, an empty zero-size spacer rendered to hold a slot becomes a projection participant: as it enters or exits it perturbs the FLIP measurement of its siblings, so a neighbour animates in from a wrong origin — typically sliding up from below instead of sideways. Reserve the slot with CSS Grid placement instead and omit the empty element entirely."
last_validated_at: "2026-06-15"
---

## The symptom

A horizontal carousel / slider built with framer-motion: a window of items
(left / center / right) animates as you page through, each item a `motion.div`
with `layout`, wrapped in `<AnimatePresence mode="popLayout">`. To keep the
centered item visually centered when an edge slot has no item (the band ends),
you render an empty placeholder `motion.div` for the missing slot.

Now one item — often a *non-edge* neighbour — animates in from the **wrong
direction**: it slides up from below (vertically) instead of the intended
horizontal slide, specifically on the transitions that add or remove the empty
slot. It reproduces only where the spacer actually renders (e.g. the desktop
multi-column grid; not on a mobile layout that shows a single item).

## The cause

`layout` makes each child participate in framer-motion's shared **layout
projection** (FLIP): on every commit it measures each element's box and animates
the delta. `mode="popLayout"` pulls exiting elements out of flow so the rest
reflow.

An empty, zero-size spacer with `layout` is *also* a projection participant.
When it enters or exits, it changes the measured layout the siblings are
projected against — and a zero-size box at the grid origin is exactly the kind of
degenerate measurement that makes a sibling's FLIP delta resolve to a wrong
origin (e.g. (0,0) / below its cell). The result is a sibling that animates in
vertically. The spacer is invisible, so the cause is non-obvious — you see a
*different* element misbehave.

## The fix: reserve the slot with CSS, not with an element

Don't add an animated node just to hold space. Keep the centered item centered
with **explicit CSS Grid placement** and simply omit the missing item:

```tsx
{slots.map(({ item, slot }) =>
  item === null ? null : (              // omit the empty slot entirely
    <motion.div
      key={item}
      layout
      variants={SLIDE}
      initial="enter" animate="stay" exit="exit"
      className={cn(
        slot === "left"   && "lg:col-start-1",
        slot === "center" && "lg:col-start-2",  // centered cell stays occupied
        slot === "right"  && "lg:col-start-3",
      )}
    >
      {/* ... */}
    </motion.div>
  ),
)}
```

With `grid-cols-3` and explicit `col-start`, the centered item is pinned to
column 2 whether or not a flanking item exists; the empty column is just empty —
no extra node, so the only projection participants are the real items and the
FLIP deltas stay clean.

Why this is the right shape: fewer animated nodes mean fewer projection
participants and fewer FLIP surprises, and the layout intent (which column an
item occupies) lives in CSS where it belongs instead of being emulated by an
invisible element. It generalises past carousels — any AnimatePresence + `layout`
list where you were tempted to render a spacer to preserve alignment.

## Verification

- Page to each end and back; every item must enter and exit along the intended
  axis, with no vertical "from below" slide.
- Confirm the centered item stays centered at the ends (the reserved column is
  still empty, just element-free).
- Reproduce at the breakpoint where the spacer used to render — the bug is
  layout-specific, so it must be gone there too.

## When this does not apply

- Children without the `layout` prop: no shared projection, so a spacer is inert
  and this is not your bug.
- A spacer that has real size and is part of the visual design (a gap element, a
  divider): it is a legitimate participant — the problem here is specifically a
  zero-size node that exists only to reserve a slot.
- A wrong-direction animation with no spacer in the tree at all: look at your
  variants and the `custom` direction prop instead.

## Retrieving this and its neighbours

```js
search_lessons({ query: "framer-motion AnimatePresence layout sibling animates from wrong direction spacer", platforms: ["react"] })
```

- [[lsn_framer_motion_variant_child_double_drive]] — a variants child driven from
  two places at once; same family, different mechanism.
- [[lsn_css_grid_sticky_needs_stretch_cell]] — the other case where grid
  placement, not an extra element, is the correct way to hold a cell.
