---
id: lsn_css_border_radius_clips_hit_testing
title: "Fix overlay canvases blocking clicks — CSS border-radius clips pointer hit-testing to the rounded shape"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [web]
  tags: [css, pointer-events, border-radius, hit-testing, overlay, canvas]
summary: "CSS hit-testing follows border-radius: clicks outside the rounded corner of an element pass through to whatever is underneath. A `rounded-full` wrapper therefore turns a square, interactive canvas into a CIRCULAR pointer zone — the decoration stays draggable while links/buttons around its square corners remain clickable. Pattern: positioning wrapper `pointer-events: none`, inner rounded wrapper `pointer-events: auto`."
problem: |
  A decorative-but-interactive element (WebGL canvas, video, large
  image) floats over page content. Canvases are rectangular: even if
  the visible figure is roughly circular, the element's square
  corners sit on top of links and buttons and swallow their clicks.

  Setting `pointer-events: none` restores the page — but kills the
  element's own drag/hover interaction. Per-pixel hit-testing on a
  canvas is possible but heavyweight.
solution: |
  Use the fact that browsers hit-test against the BORDER-RADIUS
  shape, not the bounding box:

  ```html
  <!-- positioning wrapper: lets everything through -->
  <div class="pointer-events-none absolute -top-10 right-0 h-[500px] w-[500px]">
    <!-- circular hit zone: re-enables events INSIDE the circle only -->
    <div class="pointer-events-auto cursor-grab overflow-hidden rounded-full h-full w-full">
      <canvas ... />
    </div>
  </div>
  ```

  Clicks inside the circle reach the canvas (drag, hover, tooltips);
  clicks in the square's corners — outside the radius — fall through
  to the page. No JS hit-testing, no masks, two wrapper divs.
gotchas:
  - "The rounded element also CLIPS visually (overflow-hidden) — fine for roughly-circular content; for irregular shapes consider clip-path, which clips hit-testing the same way."
  - "Tooltips appended INSIDE the rounded wrapper get clipped at the circle edge — mount them on the unclipped positioning wrapper (or a portal) if they must overhang."
  - "The inner wrapper needs explicit pointer-events: auto — children do not automatically re-enable events under a pointer-events:none parent unless set."
last_validated_at: "2026-06-12"
---

## Verification

```js
// elementFromPoint probes: corner vs centre of the rounded wrapper
const r = wrapper.getBoundingClientRect();
const corner = document.elementFromPoint(r.left + 4, r.top + 4);
const centre = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
// corner  → element UNDER the overlay (link/button/page)
// centre  → the canvas
```

If `corner` returns the canvas, the radius/clip isn't applied to
the element receiving events (check which wrapper carries
`rounded-*` + `pointer-events-auto`).

## Spec background

CSS Backgrounds & Borders defines that border-radius affects the
element's border box for painting AND pointer event hit-testing —
this is interoperable across Chromium, Firefox and WebKit. The
same applies to `clip-path` (Pointer Events spec: hit-testing
follows the clipped region).

## When this does not apply

- Content that must stay clickable across the FULL square (e.g. a
  rectangular video with controls in the corners) — radius-clipping
  would dead-zone the corners.
- React Native: its `pointerEvents` model has no CSS hit-testing
  shapes; see [[lsn_pointer_events_none_blocks_children]] for the
  native wrapper semantics instead.

## Related

[[lsn_pointer_events_none_blocks_children]] — the React Native
sibling decision tree for transparent-wrapper pointer behavior.