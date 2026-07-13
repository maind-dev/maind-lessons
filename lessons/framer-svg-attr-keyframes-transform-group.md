---
id: lsn_framer_svg_attr_keyframes_transform_group
title: "Fix SVG elements that won't move — framer keyframes on cx/cy attributes are unreliable, animate a transform group"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [web]
  tags: [framer-motion, svg, keyframes, transform, attributes, animation]
summary: "Keyframe arrays on SVG geometry attributes (cx/cy on motion.circle, x1/y1 on lines) do not reliably animate in framer-motion — the element simply stays put while opacity/color keyframes on the same element run fine. Wrap the element in a motion.g and drive x/y TRANSFORM keyframes instead (framer's core path), with the shape at local origin."
problem: |
  A flight/voyage animation moves a dot along a path using attribute
  keyframes:

  ```tsx
  <motion.circle r="3"
    animate={{ cx: [252, 246, 188], cy: [30, 34, 76], opacity: [0, 1, 1] }}
    transition={{ duration: 4.5, times: [0, 0.1, 1], repeat: Infinity }} />
  ```

  Opacity animates; the position does not — the circle sits still. No
  error, no warning. Whether attribute keyframes work depends on
  framer-motion version and how the value maps to CSS-animatable SVG
  geometry properties; treating them as reliable produces invisible
  failures that survive code review (the code "reads correct").
solution: |
  Move the motion to a transform group; keep the shape at the origin:

  ```tsx
  <motion.g
    initial={false}
    animate={{
      x: [252, 246, 188],
      y: [30, 34, 76],
      opacity: [0, 1, 1],
      transition: { duration: 4.5, times: [0, 0.1, 1], repeat: Infinity },
    }}
  >
    <circle cx="0" cy="0" r="3" />
  </motion.g>
  ```

  Transforms are framer's primary animation path (hardware-accelerated,
  version-stable). Absolute coordinates become translate values; the
  visual result is identical.
gotchas:
  - "Verify movement explicitly (two frames compared, or a style probe) — this failure is silent, and a written description of the animation is worthless without that check."
  - "Same medicine for line endpoints: animating y1/y2 attribute keyframes is the shaky variant; where possible model the line so a group transform (or pathLength) expresses the motion."
  - "transformBox: 'fill-box' + transformOrigin: 'center' matter as soon as the group also scales/rotates."
last_validated_at: "2026-06-12"
---

## Verification

```js
// two-sample probe: does the element actually move?
const el = document.querySelector("#fig g");
const a = el.getBoundingClientRect().x;
await new Promise((r) => setTimeout(r, 700));
const b = el.getBoundingClientRect().x;
console.log("moving:", a !== b);
```

If `moving: false` while opacity visibly animates → attribute-keyframe
trap; port to the transform group.

## When this does not apply

- Single-target attribute animations (no keyframe array) often work —
  the trap is specifically keyframe ARRAYS on geometry attributes.
- SMIL (`<animateMotion>`) is an alternative for path-following motion,
  but it ignores prefers-reduced-motion and React state — gate its
  rendering manually.

## Related

[[lsn_framer_animate_prop_cuts_variant_inheritance]] — companion
architecture rule for the same figures: loops on wrapper groups, variants
on shapes.