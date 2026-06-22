---
id: lsn_nextjs_fast_refresh_stale_webgl_shader
title: "Diagnose a Next.js WebGL shader that won't update on save — Fast Refresh skips the deps-stable compile effect"
type: debugging_lesson
tier: community
context:
  tools: [nextjs, react]
  languages: [typescript, glsl]
  platforms: [webgl, web]
  tags: [nextjs, fast-refresh, hmr, webgl, react-useeffect]
summary: "Editing a GLSL shader stored in a module-level const does NOT update the running WebGL canvas under Next.js Fast Refresh. The shader is compiled once in a useEffect whose deps don't include the shader string, so Fast Refresh re-renders without re-running the compile and the old program stays bound. A full hard-reload is required."
last_validated_at: "2026-06-22"
---

## Symptom

You iterate on a fragment-shader string (a `const FRAG = ...` in a `"use client"` component), save, and the on-screen WebGL effect doesn't change — repeatedly. You conclude "my edit had no effect" and start changing the wrong things, or blame caching / the wrong port. Meanwhile a fresh page load (a new tab, incognito, a headless screenshot) DOES show the change — which is the confusing part and easy to misread.

## Cause

The typical structure compiles the shader once, on mount:

```tsx
const FRAG = `...glsl...`;            // module-level constant
useEffect(() => {
  // gl.shaderSource(sh, FRAG); gl.compileShader(...); gl.linkProgram(...)
}, [reduce, w, h, reach, intensity, morph]);  // FRAG is NOT a dep
```

When you edit `FRAG`, Next.js Fast Refresh hot-swaps the module and re-renders the component, but it does **not** re-run an effect whose dependency array is unchanged. The already-compiled WebGL program (old GLSL) stays bound to the live context, so the canvas keeps rendering the old shader. No full page reload happens, so nothing forces a recompile.

## Confirmation

Verified empirically: with the page open, edit a constant inside `FRAG` to a value that would visibly change output (a brightness multiplier ~7x). No self-reload fires and the canvas does not change; a fresh navigation to the same URL renders the new value. The live context is stale; a freshly-mounted instance is not.

## Fix / workarounds

- **To see your change now:** hard reload (Cmd/Ctrl+Shift+R). A normal Fast Refresh won't recompile the shader.
- **To make dev iteration live:** add the shader sources to the effect's dependency array (`[..., FRAG, VERT]`). On Fast Refresh the new module's `FRAG` differs from the old → the effect re-runs → the shader recompiles. Harmless in production (the constant never changes).
- **When verifying via screenshots:** a headless tool that does a fresh navigation each run ALWAYS shows your latest edit, so it can disagree with what a human sees on a long-lived tab. Don't treat "the screenshot changed" as proof the user sees it — tell them to hard-reload.

## When this does NOT apply

- Shader source passed as a **prop or state** that's already in the dep array — edits then re-run the effect and update live.
- Effects that intentionally re-create the GL context every render (rare, wasteful) — they recompile anyway.
- Non-WebGL hot paths: this is about expensive resources built once in a deps-stable effect; the same shape applies to any compiled/allocated GPU/worker resource cached across renders.

## Retrieving this lesson

```
search_lessons({ query: "webgl shader does not update on save next.js fast refresh", tools: ["nextjs"] })
```

Related: [[lsn_shader_time_uniform_precision_drift_wrap_phase]] — a different WebGL shader gotcha (time-uniform precision drift over long runtime).