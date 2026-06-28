---
id: lsn_svg_preserve_aspect_ratio_none_circle_ellipse
title: "Diagnose distorted SVG dots/markers — preserveAspectRatio='none' stretches circles into ellipses"
tier: community
type: debugging_lesson
summary: "A width-responsive SVG using a fixed viewBox with preserveAspectRatio='none' (common for full-width sparklines/charts) scales the coordinate system non-uniformly. vectorEffect='non-scaling-stroke' keeps stroke width constant so lines look fine, but <circle>/point markers still distort into ellipses because they scale with the unequal x/y ratio. Use a crosshair line + DOM-overlay marker, or uniform scaling, instead of an SVG circle."
context:
  languages: [typescript, css]
  platforms: [web]
  tags: [svg, charts, sparkline, responsive, rendering]
---

## Symptom

In a width-responsive SVG chart/sparkline, the line looks correct but the hover **dot / point marker is an oval**, stretched horizontally, and gets worse as the container widens.

## Cause

To make a fixed-`viewBox` SVG fill an arbitrary container, the common trick is:

```html
<svg viewBox="0 0 200 40" preserveAspectRatio="none" class="w-full" style="height:40px">
```

`preserveAspectRatio="none"` lets the 200×40 user-space stretch to e.g. 600×40 — a **non-uniform** scale (x×3, y×1). `vectorEffect="non-scaling-stroke"` keeps **stroke width** constant, so the path looks fine. But geometry like `<circle r="3">` is scaled by the unequal x/y factors → it renders as an **ellipse** (≈3px tall, 9px wide). The same hits any shape that assumes square units (squares, regular polygons, evenly-spaced dots).

## Fix

Don't draw point markers as SVG geometry inside a non-uniformly-scaled viewBox:

- **Crosshair line + tooltip, no dot** — a vertical `<line>` (with `non-scaling-stroke`) plus an absolutely-positioned DOM tooltip indicates the hovered point without distortion. Simplest, and what most sparklines actually need.
- **Render the marker as a DOM element** (an absolutely-positioned `div`, placed by percentage) layered over the SVG — it stays round regardless of the SVG's scale.
- **Counter-scale** the marker by the inverse x/y ratio — fragile (needs the live container width); rarely worth it.

## When this does NOT apply

- With `preserveAspectRatio="xMidYMid meet/slice"` (uniform scaling) circles stay round — but the chart letterboxes instead of filling the box.
- If the SVG has a fixed (non-responsive) width, there's no non-uniform stretch.
- Strokes/lines/areas with `non-scaling-stroke` are unaffected — only shapes whose roundness/squareness matters distort.

## Verification

The hover marker stays round (or is replaced by a crosshair) at any container width; resizing the window doesn't turn it into an ellipse.