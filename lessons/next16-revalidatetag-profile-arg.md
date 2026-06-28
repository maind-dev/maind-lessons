---
id: lsn_next16_revalidatetag_profile_arg
title: "Fix `revalidateTag` TS2554 \"Expected 2 arguments\" after a Next.js 16 upgrade — it now needs `(tag, profile)`"
type: debugging_lesson
tier: community
lesson_class: architecture
quality_tier: experimental
context:
  tools: []
  languages: [typescript]
  platforms: [nextjs]
  tags: [nextjs, next-16, app-router, caching, revalidatetag, unstable_cache, cache-components]
summary: "In Next.js 16 the legacy single-argument `revalidateTag(tag)` is gone — the export is now `revalidateTag(tag, profile)`, tied to the Cache Components / `use cache` model. A one-arg call fails typecheck with `TS2554: Expected 2 arguments, but got 1`. Mixing the new signature with legacy `unstable_cache({ tags })` is not reliably supported. For `unstable_cache`, prefer time-based `revalidate`; adopt Cache Components fully if you need tag invalidation."
last_validated_at: "2026-06-01"
---

## The symptom

After upgrading to Next.js 16, code that compiled under 15 fails typecheck on a previously-valid `revalidateTag` call:

```
src/app/.../actions.ts(252,7): error TS2554: Expected 2 arguments, but got 1.
```

The call itself looks unchanged and correct against everything you remember:

```ts
import { revalidateTag } from "next/cache";
revalidateTag("plan-definitions"); // worked in Next 15, TS2554 in Next 16
```

`next dev` may not surface it (depending on whether the file is typechecked on the path you exercise); `tsc --noEmit` and `next build` do.

## What changed

In Next.js 16 the `revalidateTag` export was re-typed for the new **Cache Components** model (the `"use cache"` directive + `cacheLife`/`cacheTag`). The declaration is now:

```ts
// node_modules/next/dist/server/web/spec-extension/revalidate.d.ts (next@16.2.4)
export declare function revalidateTag(tag: string, profile: string | CacheLifeConfig): undefined;
```

The legacy single-argument form is no longer in the public type. The second `profile` argument ties an invalidation to a cache-life profile — a Cache Components concept, not a Data Cache (`unstable_cache`) concept. This is the same class of post-upgrade trap as other Next-16 surprises (`proxy.ts` adapter, `dynamic({ssr:false})` in Server Components): the framework moved a primitive into a newer subsystem and the old call shape silently became invalid.

## The decision (not just a one-line fix)

Adding a throwaway second argument to silence TS2554 is the wrong instinct — it is unverified whether the new `revalidateTag(tag, profile)` reliably invalidates entries created by the **legacy** `unstable_cache(fn, keys, { tags })` API. The two belong to different cache subsystems. So pick deliberately:

- **Staying on `unstable_cache`?** Drop tag-based invalidation and use **time-based** `revalidate` instead. For near-static data (config/catalog tables, plan definitions, feature flags) a short TTL (60–300s) is invisible to users and eliminates the per-render query without any `revalidateTag` call:

  ```ts
  export const getThing = unstable_cache(load, ["thing"], { revalidate: 300, tags: ["thing"] });
  // keep `tags` for future Cache-Components adoption; do NOT call revalidateTag against it yet
  ```

  Where a mutating action needs the editor to see their own change immediately, `revalidatePath("/that-route")` still works (one arg, unchanged) — it invalidates the route's render rather than the data-cache tag.

- **Want real tag invalidation?** Adopt Cache Components properly: enable it in `next.config`, move the cached read to a `"use cache"` function with `cacheTag(...)`, and then `revalidateTag(tag, profile)` is the matching API. This is a broader change to your rendering/caching model — scope it as such, not as a one-line patch.

## Verification

```bash
pnpm exec tsc --noEmit   # TS2554 disappears once the call is removed or the model is migrated
pnpm exec next build      # full build is the real gate
# inspect the live signature in your installed version:
grep -n "revalidateTag" node_modules/next/dist/server/web/spec-extension/revalidate.d.ts
```

## When this does not apply

- **Next.js 15 and earlier** — the 1-arg `revalidateTag(tag)` is still valid there.
- **`revalidatePath`** is unaffected — still single-argument.
- If you have already migrated to Cache Components (`"use cache"`), the 2-arg form is exactly what you want; this convention covers the *upgrade gap*, not steady-state Cache-Components code.

## Related

Find this from a symptom: `search_lessons({ query: "next 16 revalidateTag TS2554 two arguments profile", platforms: ["nextjs"] })`. Sibling Next-16 upgrade traps: [[lsn_next_16_proxy_ts_adapter_crash]], [[lsn_next_dynamic_ssr_false_client_only]].
