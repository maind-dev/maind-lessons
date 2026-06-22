---
id: lsn_svg_animated_glow_mobile_lite_variant
title: "Fix a janky / rectangle-clipped animated SVG glow on mobile — render a lite variant on touch"
type: debugging_lesson
tier: community
summary: "An animated SVG glow of stacked feGaussianBlur layers re-blurs every frame as the stroke animates/morphs — janking even a high-end phone and sometimes clipping the glow to a hard rectangle in WebKit (not just the 4096px texture cap; big GPUs mis-render large filter/mask buffers too). Fix: full glow only on desktop, a lightweight one (thin stroke + one small blur, no wide σ layer, no mask) on touch. A resized desktop window won't reproduce it — test on real hardware."
context:
  tools: [react, nextjs]
  languages: [typescript]
  platforms: [web]
  tags: [svg, fegaussianblur, mask, mobile, webkit, performance, glow, animation]
---

## The symptom

An SVG glow — a stroked path with stacked `feGaussianBlur` layers (a wide soft
halo + a tighter one + a bright core), sometimes behind a directional `<mask>` —
looks great on desktop. On a phone it either:

- **janks** badly while it animates (a travelling dash and/or a scroll-driven
  path morph), even on a top-tier device; and/or
- **clips to a hard rectangle**: the glow is cut off along straight edges, the
  bloom confined to a box, only over the real device — not in a resized desktop
  browser window.

## Why it happens

1. **Per-frame re-blur.** Every frame that changes the path (a moving
   `stroke-dashoffset`, or a morphing `d`) forces the browser to re-run all the
   blur filters. A wide blur (`stdDeviation` ~50-100) over a generous filter
   region is an expensive offscreen pass; doing it 60×/s for several layers — and
   re-evaluating a full-rect `<mask>` on top — saturates a mobile GPU. Desktop
   GPUs eat it; phones stutter.
2. **Large offscreen buffers mis-render in WebKit.** Big `<filter>` regions
   (`x/y/width/height` like `860%`) and big `<mask>` regions create huge backing
   buffers, scaled again by devicePixelRatio (2-3 on phones). It's tempting to
   blame the 4096px texture cap — but a device with a much larger cap still
   showed the rectangle, so treat it as "WebKit mis-handles oversized filter/mask
   buffers," not a simple cap you can stay just under.

Crucially, **a narrow desktop browser window does not reproduce either** — it's
the same engine family but not the mobile GPU/DPR, so it renders fine and hides
the bug. Always confirm on a real device.

## The fix: a lite variant on touch

Render the full multi-layer glow only on desktop; on touch devices render a
**lightweight** glow — a thin stroke with ONE small blur (σ ~16), no wide σ
layer, no directional mask. The animation (travelling dash, morph) stays; only
the per-frame filter cost collapses. The glow that radiates "far" is the
expensive part — keep it for desktop, drop it for touch (or fake ambient reach
with a cheap CSS radial-gradient behind the shape, which never re-blurs).

Gate the split on input capability, not width — a phone in landscape is ≥768px
wide and must still get the lite path. Use `(pointer: coarse)`, see
[[lsn_touch_detection_pointer_media_not_viewport_width]].

Beware the side-effect of swapping branches: if an effect imperatively drives the
path nodes (e.g. sets `stroke-dasharray`), the branch swap re-mounts them — put
the branch condition in the effect deps or the setup never reaches the new nodes
([[lsn_react_effect_imperative_conditional_remount_deps]]).

## Gotchas while doing this

- `stroke-dasharray: "0 0"` (which you get if `getTotalLength()` returns 0 before
  layout) **disables** dashing → a SOLID stroke, not an invisible one. Guard
  against `total === 0` before computing the dash.
- A travelling-light's directional `<mask>` math (aiming a gradient with
  `getPointAtLength`) is dead weight in the lite variant — skip it when there's
  no mask, to save per-frame work.

## Verification

- Profile on a real high-end phone, not a resized desktop window (the latter
  won't show jank or the rectangle).
- DevTools touch emulation toggles `(pointer: coarse)` so you can confirm the
  lite branch renders; but judge smoothness/clipping on hardware.

```text
search_lessons({ query: "svg glow jank rectangle clip mobile filter", platforms: ["web"] })
```

## When this does not apply

- A **static** glow (no per-frame path/dash change): the filters render once and
  composite cheaply; no need to split.
- Small blurs over small regions already within budget — measure first.
- WebGL/canvas glows: different stack, different fixes (see e.g.
  [[lsn_threejs_additive_blending_light_bg]] for blending pitfalls).
