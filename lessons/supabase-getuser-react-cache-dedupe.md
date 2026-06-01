---
id: lsn_supabase_getuser_react_cache_dedupe
title: "Dedupe Supabase `getUser()` round-trips with React `cache()` — it won't bridge middleware↔RSC"
type: workflow_best_practice
tier: community
lesson_class: architecture
quality_tier: experimental
context:
  tools: []
  languages: [typescript]
  platforms: [supabase, nextjs]
  tags: [supabase, supabase-ssr, nextjs, app-router, react-cache, getuser, performance, auth]
summary: "`supabase.auth.getUser()` is a network round-trip to the GoTrue auth server (it validates the JWT), not a local cookie read. In a Next.js App Router app the layout AND each page typically call it, so one full render does it 2–3×. Wrap it in React `cache()` to dedupe per render. Caveat: `cache()` is request-scoped within the RSC (Node) render — it does NOT bridge the Edge-runtime middleware (separate lifecycle, keeps its own `getUser()`)."
last_validated_at: "2026-06-01"
---

## The cost

`supabase.auth.getUser()` is often assumed to be a cheap local read of the session cookie. It is not: it calls the GoTrue auth server to validate the access token. `getSession()` / `getClaims()` are the local reads. So every `getUser()` is a network hop.

In a Next.js App Router dashboard the same request commonly triggers it several times:

- the Edge **middleware** calls `getUser()` (the Supabase SSR pattern refreshes the token there),
- the shared **layout** Server Component calls it to gate access,
- each **page** Server Component calls it again "for defense-in-depth".

On a full render that is 2–3 sequential auth round-trips before the page data even loads.

## The dedupe pattern

Wrap the call in React `cache()` so all callers within one server render share a single round-trip:

```ts
// lib/cached-user.ts
import { cache } from "react";
import { createClient } from "./supabase/server";

export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
```

Use `getCachedUser()` everywhere you used `supabase.auth.getUser()`. The same trick applies to a per-user RPC such as an effective-plan lookup — `cache((userId) => ...)` keyed by the argument.

## The boundary that surprises people

`cache()` memoizes **per request, within the RSC (Node) render tree**. It does NOT span:

- **Edge middleware ↔ RSC render.** Middleware runs in the Edge runtime as a separate lifecycle; its `getUser()` is not deduped against the layout's. Slimming the middleware auth chain is a separate job.
- **Soft sibling navigation.** App Router partial rendering preserves the shared layout, so navigating between sibling tabs re-renders only the page — the layout's cached call does not even run again. The dedupe therefore mainly pays off on full/initial renders and hard navigations, not on every soft tab-switch. Set expectations accordingly.

If you want to drop the network hop entirely in middleware, evaluate `getClaims()` (local asymmetric-JWT verification) — viable only when the project uses asymmetric Supabase signing keys.

## When this does not apply

- A single `getUser()` per request already (no layout+page duplication) — `cache()` adds nothing.
- Client Components — they receive the user via props from a Server Component, not via repeated `getUser()`.

## Related

Find this from a symptom: `search_lessons({ query: "supabase getUser network round-trip react cache dedupe app router", platforms: ["supabase","nextjs"] })`. See also [[lsn_supabase_multiple_gotrue_clients]] (a second client needs `persistSession: false`).
