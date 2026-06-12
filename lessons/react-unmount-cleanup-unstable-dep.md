---
id: lsn_react_unmount_cleanup_unstable_dep
tier: community
title: "Fix a long-lived resource torn down every render — unmount cleanup with an unstable dependency"
type: debugging_lesson
summary: "A cleanup-only effect — useEffect(() => () => teardown(), [cb]) — runs its teardown on EVERY render where cb's identity changes, not just on unmount. If cb is unstable (e.g. it wraps a hook returning a fresh object each render), a long-lived resource it disposes (audio element, WebSocket, observer, subscription) is destroyed and recreated repeatedly. Fix: empty deps [] plus refs for what teardown needs; never depend on a render-unstable callback."
context:
  tools: []
  languages: ["typescript", "javascript"]
  platforms: []
  tags: ["react", "hooks", "useeffect", "cleanup", "memory-leak"]
---

## The trap

You write what looks like an unmount-only teardown:

```ts
useEffect(() => () => {
  cancel();            // pause / close / disconnect
  destroyResource();   // remove <audio>, close socket, …
}, [cancel]);
```

`useEffect`'s cleanup runs **before every re-run of the effect**, not only on
unmount. The effect re-runs whenever a dependency changes identity. So if
`cancel` is a NEW function on most renders, this "unmount cleanup" actually fires
on most renders — tearing down a resource meant to live for the component's
lifetime, then recreating it.

## Why the dependency is unstable

`cancel`'s identity churns when it closes over something unstable:

```ts
const browser = useSpeechSynthesis();                 // fresh { … } each render
const cancel = useCallback(() => { … }, [browser]);   // → new cancel each render
```

A child hook returning a bare object literal (or a changing state value) ripples
instability up through every `useCallback` that depends on it.

## Symptoms

- Audio that plays but is silent / `play()` "interrupted by a call to pause()" —
  the blessed `<audio>` element is destroyed mid-session.
- WebSockets that reconnect constantly, observers that miss events, subscriptions
  that drop — all "work sometimes".

## The fix

Run the teardown ONLY on real unmount, and reference what it needs via refs:

```ts
useEffect(() => {
  return () => {
    cancelAnimationFrame(rafRef.current);
    audioRef.current?.pause();
    audioRef.current?.remove();
    audioRef.current = null;
  };
}, []); // empty deps → fires once, on unmount
```

Alternatively, stabilise the callback (memoise the child hook's return) so the
dep stops changing.

## How to detect

If a long-lived resource "resets" for no clear reason, log inside the cleanup. If
it fires on ordinary interactions (typing, status changes) rather than only on
unmount, an unstable dependency is the cause.

## When NOT to apply

If the effect genuinely SHOULD re-run on the dependency (e.g. re-subscribe when an
id changes), keep the dep — but then the teardown must be cheap and idempotent,
not disposing a resource meant to outlive the change.
