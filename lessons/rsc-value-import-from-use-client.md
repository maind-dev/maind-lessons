---
id: lsn_rsc_value_import_from_use_client
title: "Trace a redacted Server Components render crash to a value imported from a `use client` module"
type: debugging_lesson
tier: community
lesson_class: architecture
quality_tier: experimental
context:
  tools: []
  languages: [typescript]
  platforms: [nextjs]
  tags: [nextjs, app-router, react-server-components, use-client, client-reference, production-crash]
summary: "A non-component value (const, object, helper) imported from a `use client` module into a Server Component is NOT the value — the Next.js App Router turns every client-module export into a client-reference proxy, so using it server-side (`.includes()`, `.map()`) throws a TypeError in the server render. Production shows only the generic Server-Components-render error, and `tsc` + `next build` both pass. Fix: define shared constants/helpers in a plain (non-`use client`) module."
problem: "A dashboard route crashed with the redacted 'An error occurred in the Server Components render' message. The Server page imported a const array (`DAY_PRESETS`) from a `use client` filter component and called `.includes()` on it."
solution: "Move the shared constant to a plain non-client module (a `*-shared.ts` with no `use client`) and import it from there in both the server page and the client component."
gotchas:
  - "Reaching for render-layer fixes (Suspense, `force-dynamic`, `ssr:false`) — the throw is in the server logic BEFORE render, so none of them touch it."
  - "Trusting green `tsc` + `next build` — TS sees the declared type, and a dynamic (`ƒ`) route is never executed at build time."
  - "Assuming only components are affected — ALL exports of a `use client` module become client references, including plain consts and helper functions."
evidence: "Reproduced on Next.js 16 App Router. Control case: an identical `.includes()` on a constant imported from a non-client module did NOT throw — isolating the client-module import."
last_validated_at: "2026-06-10"
---

## The symptom

A Server Component (App Router page or layout) crashes with the production-redacted error:

> An error occurred in the Server Components render. The specific message is omitted in production builds…

`next build` and `tsc` both pass. The browser console shows only the same redacted text — the real message + stack live in the **server/host logs**, keyed by the error `digest`.

## The cause

The page imported a **value** (not a component) from a `"use client"` module:

```tsx
// FilterBar.tsx
"use client";
export const DAY_PRESETS = [7, 14, 30, 90] as const;

// page.tsx  (Server Component)
import { DAY_PRESETS } from "./FilterBar";
const days = (DAY_PRESETS as readonly number[]).includes(n) ? n : 14; // 💥 TypeError
```

In RSC, when a Server Component imports from a `"use client"` module, **every export becomes a client reference** (a proxy), not the real value. Dotting into it / calling a method (`.includes`, `.map`) throws during the server render. Importing a client **component** and rendering it as JSX is fine — that's the intended boundary. Plain **values used as data** are not.

## Why it hides from your gates

- **`tsc`** sees the *declared* type (`readonly number[]`) → happy.
- **`next build`** does not execute a dynamic route (`ƒ` — uses cookies / `searchParams` / `force-dynamic`); it only runs at request time.
- **Error boundary / browser console** in production strips the message; you get a digest, not the cause.

So it only ever shows up as a runtime crash in prod, with no readable message — easy to misattribute to the render layer.

## The fix

Put shared constants/helpers in a **plain module** (no `"use client"`) and import from there on both sides:

```tsx
// filter-shared.ts   ← no "use client"
export const DAY_PRESETS = [7, 14, 30, 90] as const;

// page.tsx (server)  → real array ✓
// FilterBar.tsx (client) → real array ✓
import { DAY_PRESETS } from "./filter-shared";
```

## When this does NOT apply

- Importing client **components** into a server file and rendering them as JSX — correct and intended.
- Server→server or client→client value imports — fine.
- The same `.includes()` on a constant from a **non-client** module works (that contrast is the fastest way to confirm the diagnosis).
- See also `lsn_next_dynamic_ssr_false_client_only` — the build-time counterpart of this server/client-boundary footgun (`dynamic({ ssr: false })` from a Server Component).

## Surfacing the real error fast

Prod hides the message. Read the host's server logs (keyed by the `digest`), or temporarily wrap the server logic in `try/catch` and render `err.message` / `err.stack` yourself — your own catch sees the un-redacted error.

```ts
search_lessons({ query: "use client value import server component client reference crash", platforms: ["nextjs"] })
```
