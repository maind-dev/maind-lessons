---
id: lsn_svg_smil_animatemotion_additive_offset
title: "Fix SMIL <animateMotion> particles drifting to the corner — the path is additive to the element's cx/cy"
type: debugging_lesson
tier: community
lesson_class: general
summary: "Inline-SVG SMIL particles animated along edges with <animateMotion> have two related traps: a <circle> with no cx/cy defaults to (0,0) and shows as a stray dot in the corner before its `begin` delay (default opacity 1); and because the motion path is ADDED to the element's cx/cy, setting cx/cy when the path uses absolute coords doubles the offset and throws particles into the opposite corner. Keep cx/cy at 0 and hide the pre-begin dot with opacity 0."
context:
  languages: [typescript, javascript]
  platforms: [web]
  tools: []
  tags: [svg, smil, animation, animatemotion, framer-motion]
last_validated_at: "2026-06-03"
---

## Symptom

Two related failures with inline-SVG particles that travel along edges via `<animateMotion>`:

1. A stray dot sits in the top-left corner at the start, then disappears once the animation begins.
2. After "fixing" #1 by setting `cx`/`cy`, the particles instead run off into the opposite (bottom-right) corner rather than along the path.

## Cause

`<animateMotion path="…">` applies its path as a **translation added on top of** the element's own position. With a `<circle>`:

- A `<circle>` with no `cx`/`cy` defaults to `(0,0)` — the SVG corner. During the animation's `begin` delay the element's default `opacity` is `1`, so it's a visible dot at the corner until the motion starts.
- If the path already uses **absolute** coordinates (`M182,126 L70,60`) and you ALSO set `cx={182} cy={126}`, the motion translation is added to (182,126) → the particle lands near (182+182, 126+128) ≈ the opposite corner.

## Fix

Keep `cx`/`cy` at `0` (let the absolute path position the element) and suppress the pre-`begin` dot with a base `opacity={0}`; the opacity `<animate>` ramps it up when the motion starts:

```jsx
<circle r={2.4} fill="#ff8fcb" opacity={0}>
  <animateMotion dur="2.6s" begin="0.6s" repeatCount="indefinite"
                 path="M182,126 L70,60" />
  <animate attributeName="opacity" values="0;1;1;0" dur="2.6s"
           begin="0.6s" repeatCount="indefinite" />
</circle>
```

## When this does NOT apply

- If your path coordinates are **relative** to the element origin, then `cx`/`cy` is the intended anchor and should be set.
- `<animateTransform>` and CSS transforms follow different composition rules; this is specifically about `<animateMotion>`.

Related SVG defensive-coding: [[lsn_svg_width_defensive_clamp]].
