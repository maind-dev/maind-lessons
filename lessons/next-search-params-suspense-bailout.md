---
id: lsn_next_search_params_suspense_bailout
title: "Fix `useSearchParams() should be wrapped in a suspense boundary` — Next.js static-prerender CSR-bailout"
type: debugging_lesson
tier: community
summary: "A Client Component calling `useSearchParams()` rendered inside a statically-prerenderable Next.js route (e.g. `/` with `export const revalidate`) triggers a CSR-bailout at build time: `useSearchParams() should be wrapped in a suspense boundary at page \"/\"`. `next dev` does not prerender, so the bug only surfaces on `next build` / Vercel deploys. Fix: wrap the Client subtree in `<Suspense>` at the point where the Server parent composes it."
context:
  languages: [typescript]
  platforms: [nextjs]
  tags:
    - nextjs
    - app-router
    - suspense
    - static-prerender
    - client-components
    - useSearchParams
---

## How this typically slips in

The failure is almost always introduced by a *Section-level* feature
addition, not by a page-level change:

1. A leaf Client Component (`<FilterBar>`, `<ChangelogList>`,
   `<Pagination>`) gets a new URL-state feature — typically a query
   param like `?tags=...`, `?page=2`, `?q=foo`.
2. The author reaches for `useSearchParams()` (correctly — it's the
   App-Router way to read query params on the client).
3. The component is composed somewhere up the tree into a
   statically-prerendered route, often `/`. The author never edits
   the route file.
4. `next dev` works fine; typecheck passes; lint passes — because
   `next dev` renders on demand per request, with no static-export
   phase, so the CSR-bailout check never runs.
5. `next build` (and therefore Vercel) crashes with:

   ```
   ⨯ useSearchParams() should be wrapped in a suspense boundary
     at page "/". Read more:
     https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
   Error occurred prerendering page "/".
   Export encountered an error on /page: /, exiting the build.
   ```

The error location names the **route** (`/`), not the component, so
the eye initially looks in the wrong place. The asymmetry is the
same class as `dynamic({ ssr: false })` in Server Components: a
build-only invariant that local development cannot exercise.

## Fix at the point of composition

Wrap the Client Component in a `<Suspense>` boundary inside the
Server Component parent that composes it — NOT inside the Client
Component itself (a Client Component wrapping its own
`useSearchParams` in Suspense still bails out, because the boundary
needs to be a parent of the hook call):

```tsx
// Server Component (e.g. a section composing the Client subtree)
import { Suspense } from "react";
import { ChangelogList } from "./ChangelogList"; // "use client"

export function Changelog({ entries }) {
  return (
    <section>
      {/* ... */}
      <Suspense fallback={null}>
        <ChangelogList entries={entries} />
      </Suspense>
    </section>
  );
}
```

`fallback={null}` is appropriate when the Client component is
below-the-fold or its initial render is invisible-by-default. For
above-the-fold UI, render a static skeleton that matches the
component's layout (avoids cumulative-layout-shift).

## Preventive pattern

Treat any Client Component using `useSearchParams()`, `useParams()`,
or `usePathname()` as **must-be-wrapped-by-Suspense** at the
inclusion site. Suspense is cheap and idempotent — wrapping
unconditionally at the section-composition layer makes future
additions of these hooks safe by default.

A grep audit before deploy:

```bash
# Find every Client Component using useSearchParams:
grep -rln "useSearchParams" src/ apps/*/src/

# For each, verify its inclusion site has a Suspense ancestor.
# If unsure, run a production build:
pnpm exec next build
```

Verifying a related convention is loaded:

```ts
search_lessons({
  query: "useSearchParams suspense boundary static prerender",
  platforms: ["nextjs"],
});
```

## Symptom matrix

| Symptom | Likely cause |
|---|---|
| `useSearchParams() should be wrapped in a suspense boundary at page "X"` | This convention — wrap the Client subtree |
| `useSearchParams() must be used within a Suspense boundary` (runtime) | Same bug, surfaced in a non-static route — same fix |
| Build green locally with `next dev`, red on Vercel only | Static-prerender-only check fired — this or sibling `dynamic({ssr:false})` issue |
| Error names the route but the change was in a deep Section component | This convention — the section was newly composed into a static route |

## When this does NOT apply

If the route is dynamic-rendered (`force-dynamic`, dynamic params,
`headers()` / `cookies()` reads at the route level), the bailout
doesn't trigger — `useSearchParams()` works without Suspense. But
relying on this is fragile: a future refactor that makes the route
static (e.g. removing a `headers()` read) re-introduces the bug.
Wrap proactively regardless.

## Related

- [[lsn_next_dynamic_ssr_false_client_only]] — sibling failure mode
  (Server Component calling `dynamic({ssr:false})`), same
  dev-passes / prod-fails class.
- [[lsn_next_private_standalone_config_env_leak]] — different root
  cause but same symptom shape (build green yesterday, red today,
  `next dev` unaffected).