---
id: lsn_dissolve_element_into_particles_be_the_field
title: "Dissolve an element into particles: make the element itself the particle field, not particles on top"
type: workflow_best_practice
tier: community
lesson_class: general
quality_tier: experimental
context:
  tools: []
  languages: ["typescript"]
  platforms: ["web"]
  tags: ["animation", "particles", "canvas", "motion-design", "ui"]
summary: "A 'shatter / dissolve into particles' effect only convinces when the element IS the particle field: transparent its solid background and render it as a dense field of particles in its OWN colour, then disperse them. Particles layered on top of an intact, differently-coloured background read as foreign confetti, not the thing disintegrating. Reach for a canvas once you need thousands of particles — the DOM can't carry that many nodes — and make the field dense enough to look solid at rest."
last_validated_at: "2026-06-03"
---

## The failure mode

The intuitive first attempt is to keep the element and sprinkle particles over it as it fades. It never reads as disintegration: the solid element (or its background) is still there at a different colour, and the particles look like confetti thrown on top. Fading the element while particles drift nearby is two separate effects, not one thing coming apart.

## Make the element BE the particle field

Render the element itself as the particles:

- **Transparent its solid background.** The particle field is now the only thing drawing the element's shape.
- **Particles in the element's OWN colour** (theme-aware — read it from the same design token the element used). Same-colour particles look like its material; a contrasting colour looks foreign.
- **Dense enough to look solid at rest.** Tile a grid with slight overlap (or thousands of random points) so at progress 0 it reads as the intact element.
- **On trigger, each particle disperses + shrinks + fades** → the element itself comes apart.

```ts
// grid homes tile the element solidly at rest; each has a random dispersal vector
const x = home.x + pt.dx * progress;           // progress 0→1
const y = home.y + pt.dy * progress;
const size = pt.size0 * (1 - 0.8 * progress);  // shrink to fine dust
const alpha = progress < 0.05 ? 1 : 1 - (progress - 0.05) / 0.8; // solid, then fade
```

## Implementation notes

- **Canvas past ~a thousand particles** (DOM nodes + per-frame style recalc don't scale); CSS/DOM is fine for the hundreds.
- **Scroll- or time-scrubbed:** make position/size/alpha pure functions of one progress value → it reverses cleanly and costs nothing when idle (redraw only on change).
- **DOM variant without per-particle hooks:** drive a single CSS custom property `--p` from the one progress value and let each particle be `transform: translate(calc(var(--dx) * var(--p)), …)` plus a `calc()` opacity. One subscription, hundreds of particles.

## When NOT to use this

If the element should simply fade, a plain opacity fade is lighter and clearer — don't reach for particles. And a pixel-perfect shatter of the *actual rendered pixels* needs rasterising the element (html2canvas-class), which is heavy and brittle (fonts, CORS); the own-colour particle field above gives the same read for almost none of the cost.