---
id: lsn_svg_viewbox_design_for_rendered_width
title: Size an SVG figure's viewBox from its real rendered width — not from what looks fine in the editor
type: workflow_best_practice
tier: community
summary: "An SVG figure scales as containerWidth / viewBoxWidth — type set in viewBox units shrinks by that factor. A 760-unit landscape diagram in a ~544px drawer renders 11-unit labels at 6.9px on a laptop and 3.8px on a phone: illegible on EVERY viewport, not a mobile problem. Compute the scale for the narrowest and typical containers BEFORE laying out; match the viewBox's aspect to the container (portrait column → portrait viewBox) so the scale stays near 1."
context:
  tools: []
  languages:
    - typescript
  platforms:
    - web
  tags:
    - svg
    - viewbox
    - typography
    - legibility
    - responsive
    - diagrams
---

## The failure

A hand-built SVG diagram (flow chart, architecture figure) is designed at a
comfortable landscape viewBox — say `0 0 760 380` — with 11-unit labels that
look fine in the editor. Rendered into its real container (a side drawer, a
card column, half a grid), it is uniformly scaled to fit the container width:

```
scale = containerWidth / viewBoxWidth
renderedTypePx = typeUnits × scale
```

With a 544px container: `11 × (544/760) = 7.9px`. With a phone-width 263px
body: `3.8px`. The figure is illegible **on every viewport** — this is not a
mobile edge case, though mobile is where someone usually notices first.

The design error is treating viewBox units as pixels ("11 looks fine") — they
are only pixels when scale ≈ 1, which a landscape viewBox inside a narrow
column never achieves.

## The method: compute the scale before laying out

1. Enumerate the container's real widths per breakpoint (subtract paddings):
   e.g. drawer 560px minus 2×32 padding minus 2×16 figure frame → 464px; phone
   375px → ~319px full-bleed.
2. Pick the viewBox width so the WORST scale stays near 1:
   a 340-unit portrait viewBox gives 319/340 ≈ 0.94 (phone) and 544/340 ≈ 1.6
   (desktop) — type at 13 units renders 12–21px. Legibility floor: ~11px body,
   ~9px labels.
3. Match orientation to the container: a portrait column gets a portrait
   viewBox (the figure grows *down*, and vertical overflow scrolls; horizontal
   space is the scarce axis and must set the unit).

The check is four lines of arithmetic — run it before drawing the first node,
because retrofitting means re-laying-out every coordinate.

## When this does NOT apply

- Icons and decorative SVGs without text — nothing has a legibility floor.
- SVGs rendered at fixed pixel size (width attr, no responsive scaling):
  units are pixels, WYSIWYG.
- Text kept OUTSIDE the SVG as HTML overlay — it doesn't scale with the
  viewBox (but then it must be positioned responsively itself).
- Charts with `preserveAspectRatio="none"` distort rather than scale
  uniformly — a different failure: see [[lsn_svg_preserve_aspect_ratio_none_circle_ellipse]].

## Verification

```python
VB_W = 340          # your viewBox width
for container in (319, 464, 544):
    s = container / VB_W
    print(container, round(13 * s, 1))   # 13-unit type in real px
# every line must clear your legibility floor (~11px)
```

## Retrieval

```typescript
search_lessons({ query: "svg diagram text too small container viewbox scale", platforms: ["web"] })
```