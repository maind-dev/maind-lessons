---
id: lsn_next_unstable_cache_no_cookies
title: "Fix \"cookies() inside unstable_cache\" — use a cookieless (service-role/anon) client, cache only non-user data"
type: debugging_lesson
tier: community
lesson_class: architecture
quality_tier: experimental
context:
  tools: []
  languages: [typescript]
  platforms: [nextjs, supabase]
  tags: [nextjs, app-router, unstable_cache, cookies, supabase, data-cache, caching]
summary: "`unstable_cache` must be request-independent, so calling `cookies()` — or anything that reads request headers — inside the cached function throws. The trap with Supabase: the SSR server client reads auth cookies, so wrapping a normal Supabase query in `unstable_cache` triggers it. Fix: inside the cached function build a cookieless client (service-role admin client, or a bare anon client) and cache only non-user-scoped, non-sensitive data (config/catalog/lookup tables) — never per-user rows."
last_validated_at: "2026-06-01"
---

## The symptom

Wrapping a Supabase read in `unstable_cache` fails at render/build with an error like `Route ... used "cookies" inside "unstable_cache"`. The cache function looked innocent:

```ts
export const getPlans = unstable_cache(async () => {
  const supabase = await createClient();      // SSR client → reads cookies()
  const { data } = await supabase.from("plan_definitions").select("*");
  return data;
}, ["plans"], { revalidate: 300 });
```

## Why

`unstable_cache` memoizes a value that must be identical regardless of who requests it — so its body may not read request-scoped state (`cookies()`, `headers()`). The Supabase SSR `createClient()` reads the auth cookies to attach the user's JWT, which is exactly the forbidden access.

## The fix

Inside the cached function, use a client that does not touch cookies — a service-role admin client (server-only) or a bare anon client built directly from URL + key:

```ts
import { createClient as createAdmin } from "@supabase/supabase-js";

const admin = createAdmin(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const getPlans = unstable_cache(
  async () => (await admin.from("plan_definitions").select("plan, display_name, features")).data ?? [],
  ["plans"],
  { revalidate: 300 },
);
```

## When this does not apply (and a safety rule)

This pattern is ONLY for **non-user-scoped, non-sensitive** data: config tables, plan/pricing catalogs, feature flags, public lookups. **Never** cache per-user or RLS-gated rows this way — a service-role client bypasses RLS, and `unstable_cache` is shared across all users, so you would serve one user's data to everyone. For per-user data, keep the request-scoped SSR client and dedupe with React `cache()` instead (request-scoped, not cross-request). If the data legitimately varies by user, it does not belong in `unstable_cache` at all.

## Related

Find this from a symptom: `search_lessons({ query: "unstable_cache cookies inside error supabase cookieless client", platforms: ["nextjs","supabase"] })`. For request-scoped per-user dedupe, use React `cache()` around the SSR client instead. See also [[lsn_supabase_multiple_gotrue_clients]] (a second client needs `persistSession: false`).
