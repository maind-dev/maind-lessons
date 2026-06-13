---
id: lsn_framer_motion_variant_child_double_drive
title: "Fix a framer-motion variants-child that fades in, fades out, then snaps back mid-run"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: [nextjs]
  languages: [typescript]
  platforms: [web]
  tags: [framer-motion, animation, react, variants, keyframes]
summary: A motion child that defines its own variants already inherits the parent's active variant label by propagation. Adding an explicit animate=/initial= on that child drives it a SECOND time; the two animations conflict, and a multi-keyframe value (e.g. opacity:[0,0,1] with times) gets mis-mapped against the parent's timing — producing a non-monotonic "bell + snap" instead of the intended fade. Drive each child once.
---

## Symptom

A parent `motion.div` with `variants` + `animate="run"` contains child `motion.span`s (skin overlay, badge, text layer) that should fade in partway through the parent's move. Each child has its own `variants` AND — "to be explicit" — also gets `initial=`/`animate=`. The final DOM state looks perfect (so it survives screenshot/headless checks), but in motion the child opacity/scale is non-monotonic over a single run: it rises to ~0.9 partway, falls back toward 0, then **snaps** to the final value when the parent animation completes. Visually: white → grey → white, or a badge that appears, disappears, reappears.

## Cause

In framer-motion, a parent that animates to a variant **propagates the active variant label to every descendant `motion` component that defines matching `variants`** — the child animates automatically, no `animate` prop needed. If you ALSO put an explicit `animate=` on that child, it is driven twice and the two drivers fight. Worse, a 3-point keyframe array on the child (`opacity:[0,0,1]`, `times:[0,0.46,0.56]`) can be mis-mapped against the parent's 2-point timing track under propagation, yielding the bell curve; completion then resolves to the real final keyframe (`1`), which is the snap.

## Fix

Drive each child exactly once, and prefer a simple transition over a keyframe array for crossfades:

```tsx
// Parent owns the trigger:
<motion.div variants={pill} initial="pre" animate={inView ? "run" : "pre"}>
  {/* Child: variants ONLY — it inherits "run" by propagation. No animate=, no initial=. */}
  <motion.span variants={{
    pre:  { opacity: 0 },
    run:  { opacity: 1, transition: { delay: 1.9, duration: 0.5, ease: "easeOut" } },
    rest: { opacity: 1 },
  }} />
</motion.div>
```

A 2-point `opacity: 0 -> 1` with `delay`+`duration` cannot bell-curve. If you genuinely need keyframes on a propagated child, give that child its own explicit `transition` inside the variant so the parent's timing can't leak in.

## How to confirm

Sample the actual animated CSS property numerically over time (`getComputedStyle(el).opacity` every ~150ms via the DevTools Protocol), not DOM stills — see `lsn_debug_animation_sample_computed_style_timeline`. A non-monotonic timeline (`0 -> 0.9 -> 0 -> 1`) IS the visible "double transform", in numbers. To find this from a symptom prompt: `search_lessons({ query: "framer-motion child double animation fades out", tools: ["nextjs"] })`.

## When this does NOT apply

- The child has **no** `variants` of its own — then an explicit `animate=`/`initial=` is correct and required (nothing to inherit, no double-drive).
- You **intentionally** want the child decoupled from the parent's orchestration — set `animate=` explicitly AND do not give the child variant keys that match the parent's, so propagation has nothing to bind.
- Both drivers happen to agree (same target, same timing) — no visible bug, but still remove the redundancy to avoid a latent trap when either side changes.

## Generalization

- "A `motion` child with `variants` inherits the parent variant; don't also set `animate` on it" applies to any orchestrated framer-motion tree (staggered lists, multi-layer cards, badge/skin overlays).
- Multi-keyframe arrays are the fragile part under propagation. Reach for them only when a 2-point transition truly can't express the motion, and always pin the child's own `transition`.
- Purely a client-render concern; SSR and production are unaffected, but the bug reproduces in every browser — not a dev-only StrictMode/Fast-Refresh artifact.
