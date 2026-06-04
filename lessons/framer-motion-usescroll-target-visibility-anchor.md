---
id: lsn_framer_motion_usescroll_target_visibility_anchor
title: "Fix a scroll-scrubbed animation that finishes off-screen: anchor useScroll to the visible element, not a tall ancestor"
tier: community
type: debugging_lesson
summary: "useScroll({ target }) maps progress 0 to 1 across the target's full travel through the viewport. Bind it to a tall section and a scrubbed animation on an element near the section's top finishes long after that element has scrolled off-screen. Anchor the target (and offset) to the element whose on-screen presence should drive the timing — or split phases across multiple refs."
context:
  tools: []
  languages:
    - typescript
  platforms:
    - web
    - nextjs
  tags:
    - framer-motion
    - usescroll
    - scroll-animation
    - usetransform
    - animation
---

## Symptom

A scroll-scrubbed animation (e.g. a decorative figure that fills or rotates as you scroll) starts too early and is already "done" while you are still looking at the top of a section — or worse, only completes after the relevant element has scrolled out of view.

## Why

`useScroll({ target: ref, offset })` measures progress as the **target element** travels through the viewport. Progress `0 → 1` is spread across the target's *entire* scroll extent. If you bind `target` to a tall section (heading + a long code block + footer) but the animated element sits near the section's top, then by the time progress reaches the later breakpoints, the section's top — and your element — is already gone:

```tsx
// Anti-pattern: scrub the whole (very tall) section.
const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start end", "end start"] });
// progress 0.8 happens deep into the section → element long off-screen.
const fill = useTransform(scrollYProgress, [0.3, 0.8], [0, 1]);
```

## Fix

Bind the scrub to the element whose **visibility defines the timing**, and pick an `offset` anchored to that element's edges:

```tsx
// Phase A — materialize when the heading is fully in view:
const { scrollYProgress: matProg } = useScroll({
  target: headingRef,
  offset: ["end end", "end center"], // 0 = heading bottom hits viewport bottom (just fully visible)
});

// Phase B — start a second phase when the next element is half-visible:
const { scrollYProgress: runProg } = useScroll({
  target: mockupRef,
  offset: ["center end", "center center"], // 0 = element center reaches viewport bottom (top half visible)
});
```

Use **multiple refs** when distinct phases should fire at distinct scroll depths — each phase scrubs its own element. `useTransform`'s default end-clamping then holds each phase's start/end state outside its window, so it stays reversible with no extra state.

### offset cheat-sheet

`offset: [A, B]`, each entry `"<targetEdge> <viewportEdge>"`; progress is `0` at `A`, `1` at `B`:

- `"start end"` → target top at viewport bottom (entering from below)
- `"end end"` → target bottom at viewport bottom (just fully visible)
- `"center end"` → target center at viewport bottom (top half visible)
- `"end start"` → target bottom at viewport top (fully scrolled past)

## When this does NOT apply

- This is about **scroll-scrubbed** (progress-linked) animation. For a one-shot reveal, `useInView(ref, { once: true })` is simpler and needs no offset tuning.
- Pick the target by *which element's on-screen presence should drive the value* — not by which element is convenient to ref. A tall container is almost never the right scrub target for an element-local animation.
