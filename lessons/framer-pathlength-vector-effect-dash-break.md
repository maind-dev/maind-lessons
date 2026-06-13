---
id: lsn_framer_pathlength_vector_effect_dash_break
title: "Fix unclosed/holey SVG shapes during draw-in — framer pathLength conflicts with vector-effect non-scaling-stroke"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [web]
  tags: [framer-motion, svg, pathlength, vector-effect, stroke-dasharray, line-art]
summary: "framer-motion's pathLength draw-in animation works by driving stroke-dasharray (normalized via the pathLength attribute). With vector-effect: non-scaling-stroke on the same element, the dash pattern mis-scales — shapes render partially drawn even at pathLength 1: open diamonds, 'C'-shaped circles, gaps in closed paths. Remove vector-effect from every pathLength-animated shape (and let dashed construction lines fade in via opacity instead of drawing them)."
problem: |
  Animated line-art (thin-stroke SVG drawings drawn in on scroll) renders
  broken: a closed diamond path misses one edge, circles show as "C"s,
  polygons have gaps — permanently, not just mid-animation.

  Two ingredients combine:
  1. framer's `pathLength` animation sets `pathLength="1"` on the element
     and animates `stroke-dasharray`/`stroke-dashoffset` against that
     normalized length.
  2. `vector-effect: non-scaling-stroke` makes the browser compute stroke
     geometry in SCREEN space while the dash metrics are authored in
     viewBox space — the pattern no longer matches the path's normalized
     length, so the dash never closes the shape.
solution: |
  Drop `vector-effect` from everything that animates `pathLength`:

  ```tsx
  // BROKEN: dashes mis-scale, shape never closes
  <motion.path d="M118 79 L134 95 L118 111 L102 95 Z"
    vectorEffect="non-scaling-stroke"
    variants={{ hidden: { pathLength: 0 }, visible: { pathLength: 1 } }} />

  // FIXED: no vector-effect on drawn shapes
  <motion.path d="M118 79 L134 95 L118 111 L102 95 Z" strokeWidth={1}
    variants={{ hidden: { pathLength: 0 }, visible: { pathLength: 1 } }} />
  ```

  Strokes then scale with the SVG — at marketing-figure sizes (viewBox
  280 wide rendered at ~200-300px) the difference is fractions of a px;
  bump strokeWidth slightly if needed.

  Related trap in the same figures: deliberately DASHED construction
  lines (strokeDasharray="2 4") must NOT be pathLength-animated at all —
  the draw animation overwrites their dasharray. Fade them in with an
  opacity variant instead.
gotchas:
  - "The breakage persists AFTER the animation finishes (pathLength 1 still renders through the mis-scaled dasharray) — it looks like broken geometry, not like a broken animation, which sends you debugging the path data first."
  - "Mixed figures need a split: solid strokes → pathLength draw; dashed strokes → opacity fade; dots/fills → scale pop. One variant set per stroke style."
  - "Plain CSS draw-in (manual dasharray/dashoffset) has the same conflict with non-scaling-stroke — this is a platform interaction, not a framer bug per se."
last_validated_at: "2026-06-12"
---

## Symptom recognition

| Symptom | Cause |
|---|---|
| Closed path (Z) renders with one missing edge | dash pattern mis-scaled by non-scaling-stroke |
| Circle renders as a "C" at rest | same |
| Dashed guide lines turn solid or vanish after draw-in | pathLength overwrote their dasharray |

## Verification

```tsx
// Probe: remove vectorEffect at runtime — if shapes close, this is the bug
document.querySelectorAll("svg [vector-effect]").forEach((el) =>
  el.removeAttribute("vector-effect"),
);
```

Re-render: shapes complete → port the fix into the components (and keep
dashed lines on opacity variants).

## When this does not apply

- Static line-art (no pathLength animation): vector-effect is fine and
  useful for responsive stroke consistency.
- Shapes animated via transforms/opacity only: no dasharray involvement,
  no conflict.

## Related

[[lsn_reanimated_svg_web_instability]] — a sibling class of SVG-animation
platform traps (different stack, same lesson: SVG + animation layers
interact in non-obvious ways).