---
id: lsn_framer_animate_prop_cuts_variant_inheritance
title: "Fix stuck draw-in variants — an `animate` prop on the same element cuts framer variant inheritance"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [web]
  tags: [framer-motion, variants, animate, hover, svg, animation-architecture]
summary: "In framer-motion, a child with an explicit `animate` prop (e.g. a hover loop) stops inheriting variant changes from its parent (`whileInView=\"visible\"` etc.) — its draw-in/fade variants freeze at whatever state they had. Put per-element loops (ripple, pulse, flash, breathe) on a WRAPPER group around the element and keep the variants on the element itself."
problem: |
  A figure draws in via parent-driven variants (parent: initial="hidden"
  whileInView="visible", children carry `variants={draw(...)}`). One child
  additionally gets a hover/idle loop via an `animate` prop:

  ```tsx
  <motion.circle
    variants={draw(0)}                 // draw-in from the parent variant
    animate={hovered ? ripple : undefined}  // hover loop ← cuts inheritance
  />
  ```

  Symptom: that one element stays half-drawn / invisible, or jumps to a
  stale state when hover starts before the draw finished. framer treats an
  explicit `animate` object as the element's animation source of truth —
  the parent's variant label no longer reaches it.
solution: |
  Separate the two concerns onto two elements: variants stay on the shape,
  loops go on a wrapper group.

  ```tsx
  <motion.g style={{ transformBox: "fill-box", transformOrigin: "center" }}
            animate={hovered ? ripple : undefined}>
    <motion.circle variants={draw(0)} ... />
  </motion.g>
  ```

  The group scales/pulses; the circle keeps inheriting hidden→visible from
  the parent. Works for nested cases too (fade-variants group inside a
  hover-opacity group).
gotchas:
  - "`animate={undefined}` returns the element to variant control — the bug only bites WHILE the prop is set, which makes it intermittent (hover during entry animation) and easy to misdiagnose as a timing issue."
  - "SVG wrappers need transformBox: 'fill-box' + transformOrigin: 'center' for scale/rotate loops, or the group transforms around the SVG origin."
  - "Same rule for keyframe loops driven by state (breathing, flashing): if the element also has variants, wrap it."
last_validated_at: "2026-06-12"
---

## Verification

Reproduce deterministically: hover (or enable the loop) BEFORE the
draw-in completes — the affected element freezes mid-draw. Apply the
wrapper split; the element now finishes drawing while the wrapper loops.

```tsx
// quick check in the component tree: any element with BOTH props is a bug
// candidate
grep -n "variants=" src/components/figures/MyArt.tsx | grep "animate="
```

## When this does not apply

- Elements whose ONLY animation is the loop (no variants): put `animate`
  directly on them, no wrapper needed.
- Parent-level `animate` driving the same variant labels: that IS variant
  control, not an override.

## Related

[[lsn_framer_pathlength_vector_effect_dash_break]] — the companion trap in
the same draw-in figures: pathLength × vector-effect breaks dash metrics.