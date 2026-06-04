---
id: lsn_framer_motion_svg_transform_box_pivot
title: "Fix an off-center SVG pivot in framer-motion: default transform-box is fill-box, set view-box"
tier: community
type: debugging_lesson
summary: "Animating rotate/scale on an SVG element via framer-motion's style prop emits a CSS transform with transform-box: fill-box and transform-origin: 50% 50% by default, so it pivots about the element's own bounding-box center — not a viewBox coordinate. To rotate/scale around an arbitrary viewBox point, set transformBox: 'view-box' plus an explicit transformOrigin in viewBox units."
context:
  tools: []
  languages:
    - typescript
  platforms:
    - web
    - nextjs
  tags:
    - framer-motion
    - svg
    - animation
    - transform-origin
    - transform-box
---

## Symptom

You animate an inline-SVG group with framer-motion and expect it to rotate around a specific point in the `viewBox` (say a hinge at the top-left), but it stubbornly spins around its own center:

```tsx
// Expectation: pivot at viewBox point (32, 30). Reality: pivots about the <g> bbox center.
<motion.g style={{ rotate: angle, transformOrigin: "32px 30px" }}>…</motion.g>
```

The `transformOrigin` looks like it should work, yet the pivot is wrong.

## Why

framer-motion applies `rotate` / `scale` / `x` / `y` to SVG elements as **CSS transforms**, and its SVG transform builder sets two CSS properties by default:

- `transform-box: fill-box`
- `transform-origin: 50% 50%`

With `transform-box: fill-box`, `transform-origin` resolves **relative to the element's own bounding box**, not the SVG user/viewBox coordinate system. So `"32px 30px"` is interpreted inside the element's bbox (and is anyway pulled toward the 50% default), never as the viewBox point you meant.

## Fix

Set **both** `transformBox: "view-box"` and an explicit `transformOrigin` in viewBox units:

```tsx
<motion.g
  style={{
    rotate: angle,
    transformBox: "view-box",      // resolve origin in the viewBox coordinate system
    transformOrigin: "32px 30px",  // px == viewBox units here
  }}
>
  …
</motion.g>
```

For an in-place pivot (e.g. a button scaling about its own center on press), set `transformOrigin` to that element's center in viewBox units — still with `transform-box: view-box` so the unit basis is predictable.

### Fallback if a browser still drifts

Compose the pivot manually and bypass `transform-origin` entirely via `transformTemplate`:

```tsx
<motion.g
  style={{ rotate: angle }}
  transformTemplate={({ rotate }) =>
    `translate(32px,30px) rotate(${rotate}) translate(-32px,-30px)`}
>
```

## When this does NOT apply

- This is the **CSS-transform** path (framer-motion `style={{ rotate/scale/x/y }}`). The dedicated SVG-attribute props `attrX` / `attrY` / `attrScale` animate the SVG `x` / `y` / `scale` *attributes* instead and follow different rules.
- For a static (non-animated) SVG, just use the SVG `transform` attribute `rotate(deg cx cy)` — `cx`/`cy` are already viewBox units and there is no `transform-box` concern.
- Verified against framer-motion v12 (the `fill-box` / `50% 50%` defaults live in its SVG attribute builder).

## Related

- `[[lsn_svg_width_defensive_clamp]]` — another SVG-on-web rendering gotcha (clamp computed dimensions to ≥ 0 before they reach an attribute).
