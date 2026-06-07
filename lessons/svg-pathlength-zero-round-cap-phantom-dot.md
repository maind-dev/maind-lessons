---
id: lsn_svg_pathlength_zero_round_cap_phantom_dot
title: "SVG line-draw: pathLength 0 plus a round linecap paints a phantom dot at the path start"
type: debugging_lesson
tier: community
summary: "Animating a stroked path draw-on via framer-motion pathLength (or raw CSS/GSAP stroke-dashoffset) leaves a not-yet-drawn path visible as a filled dot at its start point when strokeLinecap is round — a zero-length dash rendered with a round cap. A staged multi-edge diagram then looks littered with stray colored dots on empty canvas. Fix: keep each path opacity at 0 until its own draw begins."
context:
  tools: []
  languages:
    - typescript
  platforms:
    - web
  tags:
    - svg
    - animation
    - framer-motion
    - stroke-linecap
    - scrollytelling
---

## The symptom

You draw connector lines on-scroll (or on mount) in an SVG diagram. Several edges are staged to draw at different moments. Before an edge's turn you see a small **filled dot**, in its stroke colour, sitting exactly where that line will later start — long before the line itself appears. With many staged edges the canvas looks littered with stray coloured dots on otherwise-empty space.

It resists the obvious fixes: the dots are **not** a particle layer, a glow, debug markers, or leftover nodes — removing those changes nothing.

## The cause

A `<path stroke-linecap="round">` whose **drawn length is zero still renders**. Whether you drive draw-on with framer-motion's `pathLength` (which manages `stroke-dasharray` / `stroke-dashoffset` for you) or with raw CSS/GSAP `stroke-dashoffset`, a not-yet-drawn path is a **zero-length dash** — and a round (or square) cap on a zero-length dash paints a filled cap: a dot of diameter ≈ `stroke-width`, in the stroke colour, at the path's first point.

It is extra-confusing when the stroke colour is itself animated (e.g. amber while drawing → branch colour when done): before the draw starts the colour is clamped to the start value, so every phantom dot shares that "active" colour and reads as intentional-but-misplaced.

```tsx
// framer-motion — paints a dot at the start while pathLength is 0:
<motion.path
  d={d}
  stroke="#fbbf24"
  strokeWidth={5.5}
  strokeLinecap="round"
  style={{ pathLength /* 0 → 1 */, opacity: 1 }}
/>
```

## The fix

Gate each path's **opacity to 0 until its draw begins**. The cap-dot only exists while the length is zero, and at that moment the path is supposed to be invisible anyway:

```tsx
const drawn = useTransform(progress, edge.draw, [0, 1]); // pathLength 0→1
const appear = useTransform(progress, [edge.draw[0], edge.draw[0] + 0.004], [0, 1]); // 0 before draw
<motion.path d={d} strokeLinecap="round" style={{ pathLength: drawn, opacity: appear }} />
```

Equivalents in other stacks:

- **Raw CSS / GSAP:** keep `opacity: 0` (or `visibility: hidden`) until the dash starts retreating, or only mount the path when its turn comes.
- **`stroke-linecap="butt"`** also removes the dot (a zero-length butt cap paints nothing) — but you lose the rounded ends on the drawn line, so opacity-gating is preferable when you want round caps.

## Recognising it

The tell: the dots sit exactly at path **start coordinates**, appear only for paths that **have not drawn yet**, and survive every "remove the thing that looks like dots" attempt — because the renderer, not your code, paints them. Once you map "zero-length round-capped dash → dot", a one-line opacity gate clears a whole class of staged line-draw animations.

## When it does not apply

If your lines have no round/square caps (butt caps), or you reveal them by other means (clip-path, masked width, opacity-only fades) rather than `pathLength`/`stroke-dashoffset`, there is no zero-length dash and no phantom dot.

## Sample maind tool call

```
search_lessons({ query: "svg line draw phantom dots pathLength stroke-linecap", platforms: ["web"] })
```

Cross-ref: [[lsn_svg_width_defensive_clamp]] — another non-obvious SVG-rendering footgun in the same animated-figure context.