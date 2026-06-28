---
id: lsn_cross_element_spark_overlay_svg
title: "Animate a comet that jumps between two DOM elements — one overlay SVG, path from measured rects, mid-path swap"
type: workflow_best_practice
tier: community
summary: "Run a glowing comet that travels along element A, leaps the gap to element B, runs B's edge and burns out — firing a state change the instant it ARRIVES (Next.js 'Dynamic HTML Streaming' style). Per-element CSS borders can't cross the gap: use ONE absolutely-positioned SVG overlay over both; build the path from getBoundingClientRect() minus the overlay rect; animate a bright dash via strokeDashoffset; fire the impact callback mid-path (when the head reaches the target), not at the end."
context:
  tags:
    - animation
    - svg
    - motion-design
    - framer-motion
    - ui
  languages:
    - typescript
    - css
  platforms:
    - web
  tools: []
---

## The problem

You want a comet to run along element A's edge, jump across a gap to element B,
run down B's edge and burn out — and trigger a state change (e.g. swap B's
content) the instant it reaches B. A CSS border-beam or any per-element
animation can't cross from A to B.

## The recipe

1. **One overlay SVG** over a common positioned ancestor of A and B:
   `position: absolute; inset: 0; pointer-events: none`. Make the ancestor
   `position: relative`. No `viewBox` → 1 user unit = 1px.
2. **Build the path from measured rects** at launch (positions are stable if you
   only launch on hover or a debounced scroll-settle):

   ```ts
   const o = overlayEl.getBoundingClientRect();
   const a = elA.getBoundingClientRect();
   const b = elB.getBoundingClientRect();
   // A's edge → jump → down B's edge (coords are rect − overlayRect)
   const d = `M ${a.left-o.left} ${a.bottom-o.top} L ${a.left-o.left} ${a.top-o.top}` +
             ` L ${a.right-o.left} ${a.top-o.top} L ${b.left-o.left} ${b.top-o.top}` +
             ` L ${b.left-o.left} ${b.bottom-o.top}`;
   ```
3. **Compute segment lengths in JS** → you know `total` and `impactLen` (length
   at which the head reaches B) without touching the DOM.
4. **Animate one bright dash** with a glow filter:

   ```ts
   path.style.strokeDasharray = `${BEAM} ${total + BEAM}`;
   animate(BEAM, -total, {
     duration, ease: "linear",
     onUpdate: (off) => {
       path.style.strokeDashoffset = String(off);
       if (!hit && off <= BEAM - impactLen) { hit = true; onImpact(); } // mid-path
     },
     onComplete: onDone,
   });
   ```
5. **"Latest wins":** remount the spark via `key={runId}` so a new launch cancels
   the old animation (its cleanup calls `controls.stop()`).

## Gotchas

- The overlay must be a child of an ancestor containing BOTH elements; all path
  coords are `rect − overlayRect`.
- Launch only when positions are stable — a sticky target moves during scroll,
  so a mid-scroll launch drifts off the element.
- reduced-motion / touch: skip the spark, apply the state change instantly.
- SVG default `overflow` is hidden — keep the path inside the overlay box; clamp
  any computed dimension (`lsn_svg_width_defensive_clamp`).

## When this does NOT apply

- **Animation stays within one element:** a CSS conic-gradient border-beam or a
  single `offset-path` is simpler.
- **No mid-path event needed:** a plain CSS/`offset-path` animation with
  `onanimationend` is enough.

## Related

- `lsn_dissolve_element_into_particles_be_the_field` — sibling motion-design recipe.
- `lsn_framer_motion_svg_transform_box_pivot` — another SVG-animation gotcha.
- `search_lessons({ query: "svg comet strokeDashoffset path between elements", platforms: ["web"] })`
