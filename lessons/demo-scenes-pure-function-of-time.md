---
id: lsn_demo_scenes_pure_function_of_time
title: "Build product demos as pure functions of one clock so a scene plays live, scrubs, and exports frame-exact video"
type: workflow_best_practice
tier: community
context:
  tools: []
  languages: [typescript]
  platforms: [web]
  tags: [product-demo, animation, video-export, determinism, devtools-protocol]
summary: "Drive every scene of an animated product demo from a single clock value t, never from timers, autoplaying libraries or CSS transitions. The same code then plays live, scrubs, renders stills and exports video frame by frame through a seek hook, and every frame is reproducible. While capturing, switch CSS transitions off and keep the stage at the camera track's exact aspect ratio."
last_validated_at: "2026-10-13"
---

## The rule: a scene is f(t)

An in-browser product demo (a guided tour, a feature clip, a hero animation) is tempting to build with `setTimeout` chains, `useEffect` steps and libraries that animate on mount. That works exactly once: live, from the start, at real speed. The moment you want a scrubber, a "jump to chapter", a poster still at 12.6 s, or a video for a place that cannot run your code (docs, a wiki, social), every wall-clock animation is a frame you cannot reproduce.

Make one clock the only source of time and derive everything from it:

```tsx
const t = useDemoTime(); // MotionValue<number>, seconds; play() advances it, seek(t) sets it
const cardX = useTransform(t, [3.2, 4.0], [0, 240], { clamp: true });
const step = useTransform(t, (s) => (s < 6.8 ? "idle" : s < 9.1 ? "taken" : "done"));

// Not this — it only exists in real time:
// useEffect(() => { const id = setTimeout(() => setStep("taken"), 6800); return () => clearTimeout(id); }, []);
```

Cues live in data (`CUE.cardTaken = 6.8`), so moving a beat is a one-number edit, and tests can assert ordering ("every cue inside the clip, cursor moves forward in time") without rendering anything. Remotion and Motion Canvas enforce the same rule; this is the discipline for a hand-rolled React demo.

## Exporting video: seek, settle, capture

Do not record with a screencast — `Page.startScreencast` is driven by the wall clock and drops frames under load. Step the clock instead and screenshot each frame:

```ts
// The page exposes: window.__seek(t) → sets the clock, resolves after React commits + two rAF
for (let f = 0; f < durationSec * fps; f++) {
  await evaluate(`window.__seek(${f / fps})`);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: stageRect });
  ffmpeg.stdin.write(Buffer.from(data, "base64")); // ffmpeg -f image2pipe -framerate 30 -i - …
}
```

One seek per frame makes the export deterministic and independent of machine speed: a slow laptop takes longer, it does not produce a different video.

## Three traps that break determinism

- **CSS transitions are wall clock.** Shared UI mocks usually carry `transition-colors` or fade utilities. After a seek they are caught mid-transition, so a seeked frame differs from a fresh load at the same t. In capture mode, switch them off inside the stage only — live playback keeps them:

  ```css
  [data-frame-mode] #stage *, [data-frame-mode] #stage *::before, [data-frame-mode] #stage *::after {
    transition: none !important; animation: none !important;
  }
  ```

- **The stage box must have the camera track's exact aspect.** Camera tracks (zoom/pan keyframes) are authored in stage coordinates for one aspect. A responsive container with a slightly different aspect letterboxes or crops, and every focus point drifts off its target. Author one track per aspect (e.g. 16:9 and 2:3 portrait) and size the stage box to exactly that ratio.
- **Published renders are immutable.** Stills and videos are served with year-long cache headers; overwriting `v1/poster.webp` leaves old copies in every cache. Render to a new version path and make the render script refuse an existing one.

## Verification

Seek to the same t twice — once after playing through, once on a fresh page load — and diff the two screenshots. They should match up to anti-aliasing (a pixel or two, a few brightness steps). A larger difference means something in the frame still runs on the wall clock. For animation bugs that only show in motion, sample the property over time instead ([[lsn_debug_animation_sample_computed_style_timeline]]); for flaky pixel comparisons, see [[lsn_headless_animation_test_dom_state_not_pixels]].

Related search: `search_lessons({ query: "frame-exact product demo video export seek", tags: ["product-demo"] })`.

## When NOT to use this

- A one-off screen recording you will never edit, scrub or re-render — record it and move on.
- Demos whose content is genuinely real-time (a live log stream, a real API call): keep those as live widgets and do not pretend they can be exported.
- Greenfield video work with no need to also run live on a page: a video framework (Remotion, Motion Canvas) gives you this discipline out of the box.
