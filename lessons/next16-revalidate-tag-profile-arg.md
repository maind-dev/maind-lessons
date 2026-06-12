---
id: lsn_next16_revalidate_tag_profile_arg
title: "Fix `revalidateTag` TS2554 in Next.js 16 — pass a `profile` arg; 1-arg form is deprecated"
type: debugging_lesson
tier: community
summary: "Next.js 16 changed the signature to `revalidateTag(tag, profile)`. The Next <=15 single-arg call now fails typecheck ('Expected 2 arguments, but got 1') and is deprecated (runtime works only if the TS error is suppressed). Pass `'max'` for stale-while-revalidate, `{ expire: 0 }` for immediate expiry, or use `updateTag`. Gotcha: `'max'` is lazy — it marks the tag stale and revalidates on next visit, not instantly. It still invalidates `unstable_cache` tags."
context:
  languages: [typescript]
  platforms: [nextjs]
  tags: [nextjs, app-router, caching, revalidatetag, migration, unstable-cache]
---

## Symptom

After upgrading to Next.js 16 (observed 16.2.x), existing tag-revalidation code stops compiling:

```
src/app/(app)/admin/foo/actions.ts: error TS2554: Expected 2 arguments, but got 1.
  > revalidateTag("my-tag");
```

`next build`'s SWC compile may still pass (it does not run full `tsc`), so this only surfaces in `tsc --noEmit` / your typecheck gate — easy to miss until CI. Confirm the version and reproduce:

```bash
node -e "console.log(require('next/package.json').version)"   # 16.x
pnpm exec tsc --noEmit                                        # flags the 1-arg call; next build's SWC may not
```

## What changed (Next.js 16)

The signature gained a required second argument:

```ts
revalidateTag(tag: string, profile: string | { expire?: number }): void
```

- `tag` — the cache tag (<=256 chars, case-sensitive), as set via `fetch(url, { next: { tags: [...] } })`, `cacheTag()` inside a `'use cache'` function, or `unstable_cache`'s `tags` option.
- `profile` — the revalidation behavior:
  - `"max"` (recommended): mark the tag **stale**, then **stale-while-revalidate** — fresh data is fetched the **next time** a page using that tag is visited.
  - `{ expire: 0 }`: expire **immediately** (blocking miss on next request) — for webhooks / external callers that need instant expiry.
  - any custom `cacheLife` profile your app defined.

The **single-argument form `revalidateTag(tag)` is deprecated**, not fully removed: it still works at runtime if you suppress the TS error, but the type now requires the 2nd arg and the behavior "may be removed in a future version" (per the official docs).

## Fix — pick by intent

| You want | Call |
|---|---|
| Invalidate on next visit (most cases) | `revalidateTag(tag, "max")` |
| Immediate expiry from a Route Handler / webhook | `revalidateTag(tag, { expire: 0 })` |
| Immediate update from a Server Action | `updateTag(tag, ...)` (Next 16) |
| Not adopting tag-revalidation at all | drop `revalidateTag`; rely on `unstable_cache`'s `revalidate` TTL + `revalidatePath` |

```ts
// Server Action — recommended form:
"use server";
import { revalidateTag } from "next/cache";

export async function saveConfig() {
  await writeConfig();
  revalidateTag("app-config", "max"); // stale → revalidates on next visit
}
```

`revalidateTag(tag, "max")` also invalidates `unstable_cache` entries created with `{ tags: [tag] }` — so do **not** fall back to a time-based TTL just because the 1-arg call broke at typecheck. A common but suboptimal reaction is to delete the `revalidateTag` call and lean on `revalidate: 300` alone (up to a 5-minute propagation delay); passing `"max"` keeps next-visit freshness.

## Gotcha: `"max"` is lazy, not an immediate purge

In Next <=15, `revalidateTag(tag)` expired the entry eagerly. In Next 16, `revalidateTag(tag, "max")` only **marks** it stale — the revalidation happens when a page using that tag is **next visited**, not at call time. If you relied on immediate invalidation (e.g. the admin must see the change on the very next render), use `{ expire: 0 }` or `updateTag` instead — otherwise you will chase a "my change does not show up immediately" ghost.

## When this does not apply

- **Next.js <= 15**: the 1-arg `revalidateTag(tag)` is correct there; do not add a 2nd arg.
- **Client Components / `proxy.ts`**: `revalidateTag` is server-only regardless of version — that is a separate restriction, not this signature change.
- Related: `[[lsn_next_dynamic_ssr_false_client_only]]` — another Next.js App Router gotcha that typecheck/dev can pass but the production path masks.