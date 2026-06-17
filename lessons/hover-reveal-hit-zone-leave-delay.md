---
id: lsn_hover_reveal_hit_zone_leave_delay
title: Fix a hover-revealed control that vanishes before the cursor reaches it — continuous hit-zone + asymmetric leave-delay
type: debugging_lesson
tier: community
summary: A control revealed on :hover that sits across a visual gap from its trigger collapses the instant the cursor crosses the gap — :hover drops before the pointer arrives, so the control is unreachable. Fix with a continuous hit-zone (overlap or a padding bridge, never a margin gap) and an asymmetric transition-delay (delay while resting, delay-0 on hover) so it lingers long enough to reach. Scope the hover trigger to the control, not a large parent.
context:
  tools: []
  languages: [css, typescript]
  platforms: []
  tags: [css, hover, ux, tailwind, pointer-events]
---

## Symptom

You reveal a secondary action on hover of a button/card (a slide-out, a dropdown, a "more" pill). It appears, but when you move the mouse toward it, it vanishes before you can click.

## Root cause

Two causes, often together:

1. **Gap in the hit-zone.** The revealed element sits above/beside the trigger with a `margin` gap. The gap belongs to neither element, so when the pointer enters it `:hover` / `group-hover` is false → it collapses.
2. **pointer-events toggled off on leave.** If the element is `pointer-events-none` until `group-hover`, it stops catching the pointer the moment hover is lost — so even a brief dip kills it.

## Fixes (combine)

1. **Continuous hit-zone** — make trigger and reveal touch. Use the reveal's own `padding` as the visual gap (its box still spans to the trigger), or overlap them. Never a `margin` gap.
2. **Asymmetric leave-delay** — delay in the resting state, `delay-0` on hover, so it opens instantly but lingers ~150ms on leave:

```html
<div class="group relative">
  <button>Primary</button>
  <!-- bottom-full + pb-2 = visual gap that is still part of the hit-zone -->
  <div class="pointer-events-none absolute bottom-full pb-2 opacity-0 transition
              delay-150 duration-300
              group-hover:pointer-events-auto group-hover:opacity-100 group-hover:delay-0
              group-focus-within:pointer-events-auto group-focus-within:opacity-100">
    <button>Revealed action</button>
  </div>
</div>
```

3. **Scope the trigger** — put `group` on the small control cluster, not a huge parent (e.g. a full-bleed preview), so unrelated hovers don't fire it. Add `group-focus-within` so keyboard users get the same reveal.

## Verification

- Reveal the control, then move the mouse slowly from trigger to control across the gap — it must stay open.
- Tab to the trigger — the control must reveal (focus-within) and be reachable.

## When this does NOT apply

- **Click/tap-toggled** menus (popovers opened on click) stay open regardless of pointer position — this is a hover-only problem. On touch there is no hover, so always provide a tap path.

## Generalization & discovery

Mega-menus, split buttons, interactive tooltips, "show on hover" row actions — any pattern where the pointer must travel from the trigger into revealed interactive content.

`search_lessons({ query: "hover reveal disappears before cursor css", tags: ["hover"] })`
