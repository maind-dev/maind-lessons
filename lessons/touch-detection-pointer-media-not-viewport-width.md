---
id: lsn_touch_detection_pointer_media_not_viewport_width
title: "Detect touch with `(pointer: coarse)`, not viewport width — and keep the buttons as a fallback"
type: workflow_best_practice
tier: community
context:
  tools: []
  languages: [typescript]
  platforms: [nextjs]
  tags: [react, responsive, touch, accessibility, tailwind, ssr]
summary: "To switch UI affordances for touch (e.g. swipe gestures vs hover buttons), gate on the pointer/hover media features — `(pointer: coarse)` / `(hover: none)` — not on a `max-sm` width breakpoint. A wide tablet is still touch; a narrow desktop window is still a mouse. In JS read it via `useSyncExternalStore` (SSR-safe, no setState-in-effect). Detection is never 100% (hybrids), so make swipe an enhancement and keep the buttons reachable."
last_validated_at: "2026-06-07"
---

## The wrong proxy

Reaching for a width breakpoint (`max-sm:`, `window.innerWidth < 640`) to mean
"mobile/touch" conflates two unrelated axes:

- A **touch tablet in landscape** is wide → your `max-sm` touch UI never shows.
- A **narrow desktop window** is touch-less → it gets the touch UI it can't use.

Viewport width is about *layout*, not *input capability*.

## The right signal: pointer/hover media features

```css
@media (pointer: coarse) { /* primary pointer is imprecise → touch/stylus */ }
@media (hover: none)     { /* primary input can't hover → touch */ }
```

Tailwind v4 exposes these as variants: `pointer-coarse:` / `pointer-fine:`
(and `any-pointer-coarse:`). So `pointer-fine:opacity-0 pointer-coarse:opacity-100`
replaces the width hack.

In JS, read it reactively **and** SSR-safely with `useSyncExternalStore` — this
also sidesteps the `react-hooks/set-state-in-effect` lint that a
`useState`+`useEffect`+`matchMedia` version trips:

```ts
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(pointer: coarse)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(pointer: coarse)").matches, // client snapshot
    () => false,                                          // server snapshot
  );
}
```

`navigator.maxTouchPoints > 0` and `'ontouchstart' in window` are coarser
heuristics; `matchMedia("(pointer: coarse)")` is the precise, listenable one.

## Two caveats that matter

1. **Hybrids.** `(pointer: coarse)` reports the *primary* pointer. A touch laptop
   with a trackpad is `fine` → it keeps the mouse UI (which it can use). Want
   "has any touch at all"? Use `(any-pointer: coarse)`. For "show a swipe
   affordance," primary-is-touch is usually the right default.
2. **No signal is reliable enough to hide things.** Build it as **progressive
   enhancement**: the buttons/menu stay reachable in every mode; the swipe (or
   other touch gesture) is *added* on coarse pointers. If detection guesses
   wrong, nothing becomes unusable.

## Verification

- DevTools device/touch emulation toggles `(pointer: coarse)` — confirm the UI flips.
- Resize a desktop window narrow: the touch UI must **not** appear (width changed, pointer didn't).
- With the buttons-as-fallback rule, every action is still doable with a mouse and with a finger.