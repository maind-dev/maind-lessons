---
id: lsn_webgl_renderer_per_mount_context_exhaustion_pool
title: "Fix WebGL canvases that flicker after repeated mounts — a renderer per mount exhausts GL contexts; pool and reuse"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript]
  platforms: [react, threejs, webgl]
  tags: [webgl, threejs, react, useeffect, memory-leak, canvas, performance]
summary: "Creating a WebGLRenderer per component mount allocates a GL context per mount, and browsers reclaim disposed ones lazily — so mount/unmount churn accumulates contexts faster than they are freed. Past the ~16-context cap the browser force-drops the OLDEST, which may be a canvas the user is still looking at: live canvases flicker or blank. Fix: a module-level renderer POOL — dispose the per-mount scene, return the renderer, so live contexts are bounded by peak concurrency, not by GC timing."
last_validated_at: "2026-08-27"
---

## The symptom

A component renders a WebGL canvas (three.js scene, a shader effect, a chart).
Individually it's fine. But after the user navigates around — opening and
closing it many times, or hovering a list where each item mounts its own canvas
— the **live** canvases start to **flicker, jitter, or blank out**. A hard
refresh fixes it; it returns as you churn more mounts. The console often carries:

```
WARNING: Too many active WebGL contexts. Oldest context will be lost.
```

## The cause

Each `new THREE.WebGLRenderer()` (or `canvas.getContext("webgl2")`) allocates a
**GL context**. Browsers limit how many can be live at once (~16 in Chrome) and
**reclaim disposed ones lazily** (on GC, not synchronously at unmount). So if you
create one per mount and unmount faster than the GC runs, the count climbs. When
it crosses the limit the browser **force-drops the oldest context** to make room
— and that oldest one may be a canvas the user is still looking at, which then
loses its drawing buffer → flicker / black / frozen.

Note the count of *currently mounted* components can look healthy (1–2) while the
problem is the backlog of *not-yet-reclaimed* disposed contexts. Instance
counters won't reveal it; the GL-context warning will.

## The fix: pool and reuse the renderer

The renderer/context is the scarce, expensive resource — the per-mount scene,
geometry and material are cheap. So keep a module-level pool of renderers, reuse
them across mounts, and never destroy the context under normal churn:

```ts
const pool: THREE.WebGLRenderer[] = [];

function acquireRenderer(): THREE.WebGLRenderer | null {
  const pooled = pool.pop();
  if (pooled) return pooled;
  try { return new THREE.WebGLRenderer({ alpha: true, antialias: true }); }
  catch { return null; }            // context creation can fail — handle it
}

function releaseRenderer(r: THREE.WebGLRenderer): void {
  r.domElement.parentNode?.removeChild(r.domElement);
  pool.push(r);                     // keep the context alive for the next mount
}
```

In the effect: `acquireRenderer()`, `setSize`/`setPixelRatio`, **`renderer.clear()`**
(a reused canvas otherwise flashes the previous mount's last frame), append the
canvas. In cleanup: dispose the per-instance `geometry`/`material`/textures, then
`releaseRenderer(renderer)` **instead of** `renderer.dispose()` +
`forceContextLoss()`. Live contexts now cap at the peak concurrent count (a
handful), regardless of how many times you mount.

Bonus: three.js reference-counts compiled shader programs on the renderer, so a
reused renderer keeps the program warm → reopened canvases paint instantly
(no per-mount recompile hitch).

## Distinguishing from the adjacent context-loss conventions

Three different bugs report the same `CONTEXT_LOST` family of symptoms. Identify
which one you have before applying a fix — the remedies do not substitute for
each other.

- [[lsn_webgl_context_recreated_by_effect_dep]] — ONE component tears down and
  re-creates its OWN context because a volatile, viewport-derived value sits in
  the effect's dependency array. The tell is a loss reported at `t≈0` for two
  values of the same flag, and null shader infologs. Fix: stable deps, read the
  flag through a ref. Pooling does not help there; the churn happens within a
  single mount's lifetime.
- [[lsn_react_strictmode_dev_resource_churn_diagnose_on_prod_build]] — React
  StrictMode's dev-only double-mount doubles whatever churn you already have, so
  the symptom here can look dev-only. Reproduce on a production build before
  concluding the pool is unnecessary — StrictMode amplifies this bug, it does
  not cause it.
- **This one** — MANY mounts over time, each legitimately creating its own
  renderer, with disposal lagging behind. The tell is the explicit "Too many
  active WebGL contexts" warning while the number of mounted components is small.

```js
search_lessons({ query: "too many active WebGL contexts oldest context lost flicker remount", platforms: ["webgl"] })
```

## When this does not apply

- A single long-lived canvas, or a route that mounts one canvas once: the context
  count never climbs, and the pool is pure indirection.
- Renderers that need *different* constructor options (`alpha`, `antialias`, …):
  only identically-configured instances are interchangeable, so pool per config
  or not at all.
- A context loss with a small, stable mount count — that is one of the two
  neighbours above, not this.
- Note the pool deliberately never disposes its contexts; they live until the tab
  closes. That is the point (bounded by concurrency, not by time), but it means
  the pool is the wrong tool if you need the GPU memory back.

## Verification

- Mount/unmount the component ~30× (or hover a long list); the
  "Too many active WebGL contexts" warning must NOT appear and the live canvases
  must stay stable.
- Confirm reopened canvases don't flash the previous frame (the `clear()`).
- DevTools → Rendering / about:gpu shows the context count plateauing, not
  climbing.
