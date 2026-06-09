---
id: lsn_overflow_clip_sticky_safe_bleed_containment
title: "Fix a position:sticky pin broken by overflow:hidden on an ancestor — use overflow:clip to contain bleed"
type: debugging_lesson
tier: community
summary: "overflow:hidden on an ancestor of a position:sticky element silently breaks the pin — hidden/auto/scroll create a scroll container, so sticky pins to that non-scrolling box, not the viewport. Use overflow:clip instead: it clips the same way but creates no scroll container, so the pin survives. The mixed-axis overflow-x:visible + overflow-y:hidden also breaks it (the visible axis computes to auto). For a controlled bleed, use overflow:clip + overflow-clip-margin."
context:
  tools: []
  languages:
    - css
  platforms:
    - web
  tags:
    - css
    - position-sticky
    - overflow
    - layout
    - scrollytelling
---

## The trap

You have a `position: sticky` element that pins while you scroll — a scrollytelling figure, a pinned hero, a sticky sidebar. Content inside it visually overflows into the neighbouring section, so you reach for `overflow: hidden` on the section (or a wrapper) to clip it. **The pin stops working:** the sticky element scrolls away instead of pinning, usually with no error and a baffling "why won't it stick" hunt.

## Why hidden breaks it — and clip does not

`overflow: hidden` (also `auto` / `scroll`) turns the element into a **scroll container**. `position: sticky` pins relative to its nearest scroll container; once an ancestor becomes one, the sticky element pins relative to *that* box (which isn't scrolling) instead of the viewport — so it never appears to stick.

`overflow: clip` clips painting the same way **but does not create a scroll container** (clipped content is simply unreachable — there is nothing to scroll). So it is **sticky-safe**: it contains the bleed without breaking the pin.

```css
.section { overflow: hidden; } /* breaks the sticky child */
.section { overflow: clip; }   /* contains the bleed, pin survives */
```

## The mixed-axis trap

The natural next idea — "clip vertically but let glows bleed sideways" via `overflow-x: visible; overflow-y: hidden` — **also breaks the pin**. When one axis is `visible` and the other is not, CSS computes the `visible` axis to `auto`, which creates a scroll container. You cannot selectively clip one axis while keeping `visible` on the other.

If you genuinely want a controlled bleed margin (soft glows radiating slightly past the box), use `overflow: clip` with `overflow-clip-margin`:

```css
.section { overflow: clip; overflow-clip-margin: 48px; } /* bleed up to 48px, then clip */
```

## The fix

- Replace `overflow: hidden` on any **ancestor of a sticky element** with `overflow: clip`.
- For intentional bleed, add `overflow-clip-margin: <n>px` instead of reverting to `visible`.
- Re-verify the pin engages after the change — the bug is silent, nothing throws.

Tailwind: `overflow-clip` and `[overflow-clip-margin:48px]`. Related layout-positioning footgun: [[lsn_modal_vertical_centering_state_jump]].

## When this does not apply

If nothing inside is `position: sticky`, plain `overflow: hidden` is fine and has wider/older browser support than `clip`. `overflow: clip` needs reasonably modern browsers (Chrome 90+, Firefox 81+, Safari 16+); if you must support older Safari, prefer restructuring the layout so no clip is needed near the sticky element over forcing `hidden`.

## Sample maind tool call

```
search_lessons({ query: "overflow clip hidden breaks position sticky pin", platforms: ["web"] })
```