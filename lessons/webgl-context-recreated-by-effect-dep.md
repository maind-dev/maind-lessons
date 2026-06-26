---
id: lsn_webgl_context_recreated_by_effect_dep
title: "Diagnose CONTEXT_LOST_WEBGL from a context re-created by a volatile useEffect dep — build it once"
type: debugging_lesson
tier: community
context:
  tools: [react, nextjs]
  languages: [typescript, glsl]
  platforms: [webgl, web]
  tags: [webgl, react-useeffect, context-lost, mobile, strictmode]
summary: "A WebGL context created inside a useEffect whose dep array holds a volatile, viewport-derived flag (a DPR cap, a touch/lite flag) is torn down and re-created every time that flag flips. Rapid re-creation — amplified by React StrictMode's double-mount and mobile resize/address-bar events — drives the GPU into CONTEXT_LOST_WEBGL (glError 37442); compile/link then return null logs ('shader error: null') so it looks like a shader bug. Create the context once; read the volatile flag via a ref."
last_validated_at: "2026-06-25"
---

## Symptom

A WebGL effect (a shader glow, a canvas visual) works on desktop-wide but, on the **touch / narrow** path, renders nothing and the console shows:

```
shader error: null            // getShaderInfoLog returned null on a "failed" compile
[glow] program LINK FAILED: null glError=37442
[glow] WebGL CONTEXT LOST. lite=true dpr=2 size=500x837 morph=0.00 t=0.4s
```

`glError 37442` is `0x9242` = **CONTEXT_LOST_WEBGL**. The null infologs are the tell that it is **not a shader bug**: the context is already dead when `compileShader`/`linkProgram` run, so their logs are null. Often the loss is reported for *two* configs (e.g. `lite=false` then `lite=true`) — the fingerprint of the context being re-created.

## Cause: the effect re-creates the GPU context

The context is created inside a `useEffect`, and a **volatile, viewport-derived value sits in its dependency array**:

```tsx
useEffect(() => {
  const gl = canvas.getContext("webgl");
  // …compile, link, rAF loop…
  return () => gl.getExtension("WEBGL_lose_context")?.loseContext();
}, [w, h, /* … */ lite]);   // `lite` = (pointer:coarse || width<768), a DPR cap
```

Every time `lite` flips, React re-runs the effect: cleanup calls `loseContext()` and a **new** context is created. `lite` flips a lot on the touch/narrow path:

- crossing the 768px / `(pointer: coarse)` breakpoint on resize,
- the **mobile address bar** showing/hiding on scroll (a viewport resize),
- **React StrictMode** (Next.js dev default) double-invokes effects (mount → unmount → mount), adding its own create/destroy cycle.

Browsers also cap the number of live WebGL contexts (~8–16) and drop the oldest. Rapid create/destroy churns the GPU process → `CONTEXT_LOST_WEBGL`. Because it only fires where the flag flips, **desktop-wide (stable flag) works** — which misdirects the diagnosis toward "the mobile GPU" or "the lite shader."

## Fix: create the context once; read the flag via a ref

Keep volatile, frequently-changing inputs OUT of the context effect's deps. Read them through a ref updated in a tiny separate effect, and apply their effect (here: the DPR cap) through the existing resize path — not by rebuilding the context.

```tsx
const liteRef = useRef(lite);
useEffect(() => { liteRef.current = lite; }, [lite]);   // cheap, no GL teardown

useEffect(() => {
  const gl = canvas.getContext("webgl");
  const getDpr = () => Math.min(devicePixelRatio, liteRef.current ? 1.0 : 1.5);
  // resize() reads getDpr() and resizes the canvas — no new context
  // …compile once, link once, rAF loop…
  return () => gl.getExtension("WEBGL_lose_context")?.loseContext();
}, [/* stable deps only — NO `lite` */ w, h]);
```

The same discipline applies to any other often-changing prop the GL effect reads (a colour/press target, a hovered index): route it through a ref so the context is built exactly once.

## How to confirm

- Log `gl.getError()` after compile/link — `37442` = CONTEXT_LOST, not a shader error. Add `canvas.addEventListener("webglcontextlost", …)` that logs the env; if it fires at `t≈0 / morph=0`, it is at init (churn), not during use.
- Count contexts: a loss reported for two flag values (`lite=false` + `lite=true`) means the context was re-created.
- A production build (no StrictMode) loaded already-narrow (no resize flip) should now show a single `init` and no loss.

## Retrieving this lesson

```
search_lessons({ query: "webgl CONTEXT_LOST_WEBGL shader error null on mobile resize", tools: ["react"] })
```

## When this does NOT apply

- The dep genuinely requires a fresh context (switching `webgl` ↔ `webgl2`, or a canvas that truly remounts) — then re-running is correct; throttle/guard the churn instead.
- A real shader compile error: `getShaderInfoLog` returns a non-null message and `getError()` is `0` / `INVALID_*`, not `37442`.
- The inverse bug — an imperative effect that should re-run on a branch flip but does not because the condition is missing from deps — is [[lsn_react_effect_imperative_conditional_remount_deps]]. Same discipline (deps must match what the effect needs), opposite failure.

Related: [[lsn_svg_animated_glow_mobile_lite_variant]] — the SVG-glow sibling (when WebGL is not wanted on touch, a lite SVG variant is the fallback).