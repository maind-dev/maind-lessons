---
id: lsn_debug_animation_sample_computed_style_timeline
title: "Diagnose a visible animation bug by sampling the animated property over time, not by DOM snapshots"
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools: [claude-code]
  languages: [typescript, javascript]
  platforms: [web]
  tags: [debugging, animation, devtools-protocol, headless, framer-motion]
summary: When a user reports a visible animation defect (flicker, double-play, jank) but your DOM snapshots, render-count traces, and code-reading all look clean, stop reasoning and sample the animated CSS property numerically over time via the DevTools Protocol. The per-frame interpolation timeline is the ground truth; a still of the resting state and a React render-count are not.
---

## Symptom

A user reports a clearly visible animation defect — an element flickers, plays twice, goes white→grey→white, janks. Your investigations all come back clean: DOM snapshots of the end state look perfect, a render-count / lifecycle trace shows the expected single mount and single state change, and the code reads correctly. You ship a fix; the user says it still happens. Repeat. This loop can burn enormous effort (and tokens) because every signal you sampled is the wrong signal.

## Why stills and render-counts lie here

- A **screenshot** captures the resting/final state. The defect lives in the per-frame interpolation *between* states, which a still never sees.
- A **render-count / lifecycle trace** captures React/JS state transitions, not painted frames. An animation can be visibly wrong while React fired exactly one state change (e.g. a single keyframe track that interpolates non-monotonically).
- **Code-reading** anchors you to your mental model of the library; animation libs (framer-motion variant propagation, CSS transition compositing, Web Animations timing) routinely violate that model.

## Method: numeric property timeline over CDP

Sample `getComputedStyle(el).<animatedProp>` every ~150ms across the run via the Chrome DevTools Protocol. Node 22+ has a global `WebSocket`, so no Puppeteer/Playwright install is needed:

```js
// 1) launch: chrome --headless=new --remote-debugging-port=9222 about:blank
const ws = new WebSocket(pageWsUrl); // from http://127.0.0.1:9222/json
const send = (m, p = {}) => /* id+resolve over ws */;
// CRITICAL: headless reports prefers-reduced-motion: reduce → the animation
// won't run and frames are blank. Force it off:
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
});
await send("Page.navigate", { url: "http://localhost:3000/" });
// scrollIntoView the trigger, then every ~150ms:
const probe = `(() => {
  const el = document.querySelector('YOUR_SELECTOR');
  return JSON.stringify({ opacity: +getComputedStyle(el).opacity,
                          x: getComputedStyle(el).transform });
})()`;
// → a non-monotonic opacity timeline (0 -> 0.9 -> 0 -> 1) IS the visible
//   "double transform", in numbers — unambiguous, reproducible, falsifiable.
```

A monotonic timeline clears the property; a bell, a snap, or a restart pins the bug to that property and time-window.

## When this does NOT apply

- The defect reproduces instantly and obviously in a real browser — just watch it; don't build a harness.
- The bug is a one-time render/layout issue (wrong final position, missing element), not an interpolation — a snapshot already answers it.
- You cannot force the animation to run headlessly (gesture/scroll-driven with complex preconditions) — drive it in a real browser with the same `getComputedStyle` sampling from the console instead.

## Generalization

- Works for any animated CSS property (`opacity`, `transform`, color) and any engine (framer-motion, CSS transitions, GSAP, Web Animations) — the property timeline is engine-agnostic ground truth.
- Trust the user's live observation over your headless stills: if they see a defect and your snapshot looks clean, your sampling is wrong, not their eyes.
- A concrete application: `lsn_framer_motion_variant_child_double_drive` was found exactly this way. Related search: `search_lessons({ query: "animation flickers double play debug", tools: ["claude-code"] })`.
