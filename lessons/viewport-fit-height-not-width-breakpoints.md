---
id: lsn_viewport_fit_height_not_width_breakpoints
title: "Fit a sticky/scrollytelling section to short laptops by gating compaction on viewport HEIGHT, not width"
type: workflow_best_practice
tier: community
summary: "Fitting a position:sticky / scrollytelling section to laptops is a viewport-HEIGHT constraint, but the reflex is width breakpoints — which shrink content on large screens with plenty of room. Keep full size as the default and gate compaction on max-height (or vh); Tailwind lacks height breakpoints by default, so use [@media(max-height:Npx)]. Also pin the grid row with minmax(0,1fr) + min-h-0 so the h-full media column does not grow with the taller text column and overflow."
context:
  tools: []
  languages:
    - css
  platforms:
    - web
  tags:
    - css
    - responsive
    - position-sticky
    - scrollytelling
    - layout
---

## The symptom

A scroll-pinned section — a scrollytelling figure beside intro text, a sticky hero — looks right on your monitor but **falls apart on a laptop**: content overflows the pinned viewport into the next section, and controls/CTAs at the bottom of the text column drop below the fold. The naive fix — shrink the text — then makes it **too small on large screens that had plenty of room**.

## Viewport-fit is a height problem, not a width problem

The thing that runs out is **vertical** space (`100vh − nav` for the pinned area), yet the reflex is to reach for **width** breakpoints (`md:`, `lg:`) or width-based `clamp()`. Width breakpoints fire the wrong way on big-but-short screens (e.g. 1440×800) and miss small-but-tall ones — you compact on the wrong axis.

## Gate compaction on max-height, keep full size as the default

Make the **full size the default** (so spacious screens look untouched) and apply compaction only through **height** media queries:

```html
<!-- Tailwind has no height breakpoints by default → arbitrary variant: -->
<h2 class="text-[40px] [@media(max-height:800px)]:text-[34px] [@media(max-height:700px)]:text-[28px]">…</h2>
```

Plain-CSS / vh equivalents:

```css
.title { font-size: 40px; }
@media (max-height: 800px) { .title { font-size: 34px; } }
/* or continuous: */
.title { font-size: clamp(28px, 4.6vh, 40px); }
```

`vh`-based `clamp()` scales smoothly with height; stepped `max-height` queries give an exact "looks like before above N px."

## Stop the media column growing with the text column

In a two-column `grid` where one column is tall intrinsic text and the other an `h-full` figure, the **auto-sized row grows to the taller (text) content**, dragging the `h-full` figure past the pinned viewport → overflow. Pin the row so neither cell can grow the track:

```html
<div class="grid h-full md:grid-cols-2 md:[grid-template-rows:minmax(0,1fr)]">
  <div class="min-h-0">…tall text…</div>
  <div class="min-h-0 h-full">…h-full figure…</div>
</div>
```

`minmax(0,1fr)` + `min-h-0` keep the track at the container height instead of growing to content, so the figure scales to the pin height. Pair with `overflow: clip` on the section to contain residual bleed — see [[lsn_overflow_clip_sticky_safe_bleed_containment]].

## When this does not apply

If the section is not height-pinned (normal flow that can grow), let it grow — height gating is unnecessary. For genuinely width-driven reflow (column count, wrapping) width breakpoints remain correct; this is specifically about content that must fit a fixed vertical budget.

## Sample maind tool call

```
search_lessons({ query: "fit sticky scrollytelling short viewport height breakpoint", platforms: ["web"] })
```