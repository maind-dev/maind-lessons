---
id: lsn_autoplay_scroll_driven_sticky_animation
title: "Fix auto-play that un-pins a sticky scroll animation — animate the window scroll, cancel on input not scroll"
type: workflow_best_practice
tier: community
summary: "To add auto-play and skip to a scrollytelling section whose visuals are pinned with position:sticky and driven by scroll progress, do not feed the animation a decoupled time-based progress — that breaks the sticky pin. Animate the window scroll itself (window.scrollTo per frame) so real scroll keeps driving the pin and the progress. And cancel auto-play on input events (wheel/touchmove/keydown), not the scroll event — your own scrollTo fires scroll every frame and would cancel itself."
context:
  tools: []
  languages:
    - typescript
  platforms:
    - web
  tags:
    - scrollytelling
    - sticky
    - framer-motion
    - animation
    - ux
last_validated_at: "2026-06-06"
---

## The setup

A scrollytelling section animates from `scrollYProgress` (e.g. framer-motion `useScroll`) while a tall wrapper plus a `position: sticky` child pin the visuals. The whole animation is a pure function of the real scroll position. You want **Auto-play** (watch hands-free) and **Skip** controls.

## Pitfall 1 — do not decouple progress from scroll

The tempting design is to feed the animation a separate, time-animated `progress` MotionValue during auto-play and ignore scroll. **It breaks the layout:** the sticky pin is positioned by *real* scroll. If progress advances while the page does not scroll, the section never pins — the visuals play out wherever the unscrolled page left them, not in the pinned frame.

Instead, **animate the window scroll itself**; the real scroll then keeps driving both the pin and the progress, so everything stays consistent:

```ts
import { animate } from "framer-motion";

// scrollY at progress 1 for a useScroll offset of ["start end","end end"]:
const endY =
  wrap.getBoundingClientRect().top + window.scrollY + wrap.offsetHeight - window.innerHeight;
const fromY = window.scrollY;
const controls = animate(fromY, endY, {
  duration: BASE_SECONDS * ((endY - fromY) / wrap.offsetHeight), // scale by remaining distance
  ease: "linear",
  onUpdate: (y) => window.scrollTo(0, y),
});
```

"Skip" is then just `window.scrollTo({ top: endY })`.

## Pitfall 2 — cancel on INPUT events, not the scroll event

You want auto-play to stop the instant the user takes over. The obvious listener — `scroll` — is wrong: your own `window.scrollTo` fires `scroll` every frame, so auto-play cancels itself immediately.

Listen for the **input** events a user produces but programmatic scroll does not:

```ts
// attach only while playing; clean up on stop / unmount
const stop = () => controls.stop();
window.addEventListener("wheel", stop, { passive: true });
window.addEventListener("touchmove", stop, { passive: true });
window.addEventListener("keydown", (e) => {
  if (NAV_KEYS.has(e.key)) stop(); // Space, ArrowUp/Down, PageUp/Down, Home, End
});
```

`scrollTo` emits `scroll` but never `wheel` / `touchmove` / `keydown`, so this cleanly separates "the user grabbed the wheel" from "I am scrolling the page myself."

## Finishing touches

- **Gate the controls' visibility** to a progress threshold (only offer them once a meaningful beat has built) and only while the section is in view, so the input listeners are not live off-screen.
- **Reduced-motion / touch:** render no controls — there is no scroll-built animation to play or skip. Note the early `return null` for that case must sit AFTER all hooks (see [[lsn_react_hooks_before_early_return]]).
- **Status:** drive a progress bar straight off `scrollYProgress` (e.g. a `scaleX` motion value), so it reflects auto-play and manual scroll identically.

## When this does not apply

If the animation is NOT sticky-pinned to real scroll — e.g. an inView-triggered or autoplay-on-mount animation, or a video-style timeline detached from layout — skip the window-scroll trick entirely and just animate a `progress` value directly. The window-scroll approach is needed ONLY because the layout (the sticky pin) depends on actual scroll position; without that coupling it is unnecessary overhead.

Each wrong path looks reasonable: "decouple progress" seems cleaner but silently
un-pins the layout, and "listen for scroll to detect the user" is the natural
guess but makes auto-play that kills itself on frame one. Anchoring on **animate
the real scroll; cancel on input** keeps the whole feature around 40 lines and
robust.

```js
search_lessons({ query: "scroll-driven sticky animation auto-play skip control", platforms: ["web"] })
```

- [[lsn_sticky_scroll_scene_progress_not_position]] — the sibling rule for the
  same kind of section: drive it from scroll PROGRESS, not from item positions.
