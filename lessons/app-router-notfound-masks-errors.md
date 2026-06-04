---
id: lsn_app_router_notfound_masks_errors
title: "notFound() in a catch-all turns real failures into a misleading 404 — gate it to the access error"
type: debugging_lesson
tier: community
summary: "A server component/page that wraps a data load in try/catch and calls notFound() on ANY error converts genuine failures (a throwing loader, a DB error) into a 404 that reads as 'route does not exist'. The real error appears only in server logs, steering debugging toward routing/auth. Reserve notFound() for the deliberate not-found/forbidden case; log and re-throw everything else so it surfaces via the error boundary."
context:
  tools: []
  languages: ["typescript"]
  platforms: ["nextjs"]
  tags: ["nextjs", "app-router", "error-handling", "notfound", "silent-failure"]
---

## Symptom

A route that clearly exists returns 404 in production, while a sibling route
sharing most of the same code works fine. Nothing in the UI hints at the cause;
the only trace is a `console.error` line in the server logs.

## Root cause

App Router pages often gate access with `notFound()` (it renders the nearest
`not-found.tsx`). A common shortcut treats ALL load failures as "not found":

```tsx
try {
  data = await loadThing(params);
} catch (err) {
  console.error("[route] load failed", err);
  notFound();            // every error becomes a 404
}
```

When `loadThing` throws for a real reason — a downstream helper that crashes on
a new input, a transient DB error, a misconfiguration — the user sees "this
page doesn't exist", the most misleading possible signal. You check routing,
file names, and auth before finding the throw in the log.

## Fix — gate notFound() to the expected case, propagate the rest

```tsx
try {
  data = await loadThing(params);
} catch (err) {
  // The ONE expected "hide this route" signal -> 404 (intentional).
  if (err instanceof Error && err.message === "forbidden") notFound();
  // Anything else is a real failure: log AND re-throw so the error boundary
  // surfaces it (500 + stack) instead of a fake 404.
  console.error("[route] load failed", err);
  throw err;
}
```

Use a typed sentinel or a dedicated error class for the "hide it" case.
Everything else reaches `error.tsx` / the default error page, where the real
cause is visible. Pairs with [[lsn_surface_silent_errors_first]].

## Boundary — when notFound() IS correct

`notFound()` is right when the resource genuinely doesn't exist, or when the
viewer must not even learn it exists (the deliberate 404-instead-of-403 privacy
pattern). The anti-pattern is the blanket `catch -> notFound()` that cannot
tell "forbidden / missing" apart from "the loader crashed".

## Why a 404 hurts more than a 500 here

A 500 says "something broke, read the logs"; a 404 says "you're in the wrong
place" and actively steers debugging away from the real cause. Distinguishing
the two is the difference between a one-log-line fix and an hour of routing/auth
spelunking.
