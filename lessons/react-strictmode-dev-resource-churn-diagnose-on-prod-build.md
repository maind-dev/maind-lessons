---
id: lsn_react_strictmode_dev_resource_churn_diagnose_on_prod_build
title: "Diagnose a dev-only client crash on a production build — StrictMode double-mount churns effect resources"
type: debugging_lesson
tier: community
context:
  tools: [react, nextjs]
  languages: [typescript]
  platforms: [web]
  tags: [react, strictmode, useeffect, dev-vs-prod, debugging]
summary: "A client-side runtime failure (WebGL CONTEXT_LOST, a dropped/duplicate WebSocket, leaked observers) that reproduces in dev but is hard to pin can be a React StrictMode artifact: in dev (Next.js default) StrictMode mounts every effect twice (mount → cleanup → mount). For effects that create/destroy an expensive or singleton resource, that rapid churn breaks it — and it does NOT happen in production (single mount). Before concluding the feature is impossible, reproduce on a production build."
last_validated_at: "2026-06-25"
---

## Symptom

A client-side runtime bug shows up while developing but resists diagnosis:

- a WebGL context that immediately reports `CONTEXT_LOST_WEBGL`,
- a WebSocket/SSE that connects twice or drops right after opening,
- an `IntersectionObserver`/`ResizeObserver`/event listener that double-fires or leaks,
- a map/chart/audio SDK instance that errors on init.

It feels worse in dev than when you click around the deployed app, and "fixes" don't stick because the trigger is the environment, not the code path you're editing.

## Cause: StrictMode mounts effects twice in dev

React 18+ **StrictMode** (enabled by default in Next.js dev — `reactStrictMode: true`) intentionally runs each effect **mount → cleanup → mount** on the first render, to surface setup that isn't idempotent. For an effect that **creates and tears down an expensive/singleton resource**, that is a rapid create → destroy → create cycle:

```tsx
useEffect(() => {
  const gl = canvas.getContext("webgl");   // or new WebSocket(), new AudioContext()…
  // …setup…
  return () => gl.getExtension("WEBGL_lose_context")?.loseContext();   // teardown
}, [deps]);
```

The churn (plus Fast Refresh re-mounting on every edit) drops/loses the resource. **Production builds do not double-mount**, so the failure is dev-only — which sends you chasing the wrong cause (the GPU, the network, the library).

## The discipline: verify on a production build before concluding

Before deciding "this can't work" / "it crashes on device", reproduce on a **production build**, where StrictMode is off and there's no Fast Refresh:

```bash
next build && next start      # or your framework's prod serve
```

- Bug **vanishes** in prod → it was dev StrictMode/Fast-Refresh churn. The feature is fine.
- Bug **persists** in prod → it's real; now debug it for real.

Do NOT "fix" it by deleting `reactStrictMode` — StrictMode is correctly flagging non-idempotent setup. The real fix is to stop re-creating the resource on every mount/dep-change: create it once and read volatile inputs via refs (a concrete WebGL instance of this is `lsn_webgl_context_recreated_by_effect_dep`), or make setup/teardown fully idempotent and double-mount-safe.

## When this does NOT apply

- The bug reproduces in the **production build too** — StrictMode just surfaced it earlier; fix the underlying non-idempotency, don't blame StrictMode.
- SSR/hydration mismatches — a different mechanism, not double-mount.
- Pure render bugs with no effect-created resource — double-mount of a side-effect-free effect is harmless.

Related: [[lsn_react_effect_imperative_conditional_remount_deps]] — same root discipline (an effect's lifecycle vs its deps), a different failure (under-firing on a branch flip).