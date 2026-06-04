---
id: lsn_scroll_opacity_floor_leaves_ghost
title: "Fix a scroll-linked element that never fully fades — a non-zero opacity floor freezes once progress clamps"
type: debugging_lesson
tier: community
lesson_class: general
quality_tier: experimental
context:
  tools: []
  languages: ["typescript"]
  platforms: ["web"]
  tags: ["animation", "scroll", "opacity", "framer-motion", "gotcha"]
summary: "A scroll-linked fade written as useTransform(scrollProgress, [a, b], [1, 0.2]) clamps to 0.2 once scrollProgress passes b — so the element sits at 20% opacity forever after you scroll past it, a frozen (often blurred) ghost in the background. Map the output's end value to exactly 0 when the element should disappear. The clamp at the range end freezes whatever floor you left in the output range."
last_validated_at: "2026-06-03"
---

## The symptom

You fade something out on scroll and a faint, often heavily-blurred remnant stays on screen forever once you have scrolled past it. You probably wrote the output range ending at a small non-zero value (`0.2`, `0.08`) thinking "mostly faded is enough".

## Why it happens

A scroll-progress value is clamped to its range. Map it through `useTransform(p, [a, b], [1, 0.2])` and once `p ≥ b` the output is pinned at the end value `0.2` — permanently, for as long as the element is past the range. It is not still animating; it is frozen at the floor you specified. Any blur/saturate filter you also applied compounds it into a visible ghost.

```ts
// Ghost: clamps to 0.2 and stays there after you scroll past
const o = useTransform(scrollYProgress, [0, 1], [1, 0.2]);
// Fix: end at exactly 0 so it truly disappears
const o = useTransform(scrollYProgress, [0, 0.85], [1, 0]);
```

## Verification

Scroll well past the element and check its computed opacity is `0` (not the floor). In devtools the element should be fully gone, not a dimmed/blurred layer still painting.

## When a floor is correct

If you *want* a persistent dimmed state (a backdrop that stays at 30%), the floor is intentional — keep it. The bug is only when the element is meant to disappear and instead lingers.