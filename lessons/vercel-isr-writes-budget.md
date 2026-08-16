---
id: lsn_vercel_isr_writes_budget
title: "Fix Vercel ISR-writes limit exhaustion — on-demand revalidation instead of short revalidate timers"
type: debugging_lesson
tier: community
summary: "Vercel bills every ISR regeneration on one rolling-30-day meter (Hobby: 200k writes) — ISR pages, ISR-cached route handlers, and fetch Data-Cache expiries alike, regardless of byte-equality. The classic burner: a sitemap-listed generateStaticParams family on a short `revalidate` — crawler traffic alone regenerates N pages × 1440/day. Fix: long fallback TTLs + on-demand revalidatePath pushed from CMS mutation points; volatile machine data behind a force-dynamic route with s-maxage CDN caching."
context:
  tools: []
  languages:
    - typescript
  platforms:
    - vercel
    - nextjs
  tags:
    - vercel
    - isr
    - caching
    - revalidation
    - cost-budget
    - app-router
---

## The symptom and the meter

Vercel reports the ISR-writes limit reached (Hobby: 200,000 per **rolling 30-day window** — no monthly reset; old writes only age out after 30 days). Traffic looks modest, content changes maybe weekly, yet the meter is full.

One meter, three producers — all billed identically:

1. **ISR page regenerations** — every expiry-triggered re-render of a `revalidate`d route is a write, **even when the output bytes are identical**. ("Avoid timestamps in cached pages" does NOT reduce write count — a regeneration writes regardless; volatile values only prevent byte-equality, which matters for debugging, not billing.)
2. **ISR-cached route handlers** — a `GET()` without a `request` parameter plus `export const revalidate` is prerendered and regenerates like a page.
3. **Data-Cache writes** — every expiry of a `fetch(url, { next: { revalidate: N } })` entry, including inside `force-dynamic` routes.

## The multiplication trap

The dominant burner is almost always a **`generateStaticParams` family × short TTL × crawlers**:

- N detail pages (changelog entries, blog posts, products) each carry the segment's `revalidate = 60`.
- All N are in the sitemap; `robots.txt` allows everything.
- Crawlers walk the family continuously — every hit after TTL expiry triggers a background regeneration + write. No human traffic required.

Worst case: N × 1440 writes/day. 90 pages at 60s is a theoretical 129,600/day — the whole monthly budget in under two days. A homepage alone at `revalidate = 60` can burn ~43k/month.

Audit greps:

```bash
grep -rn "export const revalidate" src/ | grep -v " false"
grep -rn "next:.*revalidate" src/
```

Any `revalidate` export **outside** `page` / `layout` / `route` / `template` files is inert segment config — it compiles, typechecks, and is silently ignored (see [[lsn_nextjs_revalidate_page_level_only]]); delete it or move it to the route file.

## The fix pattern (three moves)

**1. TTLs become fallbacks, not the freshness mechanism.** Human-cadence content (CMS rows edited weekly) gets hours/days: detail pages 86400, listings/home 3600. After this, worst case is N + a handful of writes per day. (Every deploy invalidates the ISR cache anyway — on a frequently-deployed site, a 24h fallback is almost never the binding freshness constraint.)

**2. Push freshness from the mutation point (on-demand revalidation).** Add a `POST /api/revalidate` route handler on the site: shared secret in a header (compare with `crypto.timingSafeEqual`), body `{ paths: string[] }`, call `revalidatePath(path)` per entry — in Next.js 16 prefer `revalidatePath` (one arg, unchanged) over `revalidateTag`, which now requires a second `profile` argument tied to Cache Components (see [[lsn_next16_revalidatetag_profile_arg]]). Call the hook from the CMS/dashboard server actions after successful writes. Two traps:

- **`await` the hook call in serverless actions.** After the response is sent, the lambda freezes — a fire-and-forget `fetch` may never leave the machine. Await it, but make it fail-soft (missing secret → warn + skip; network error → log, never throw): a publish must not fail because revalidation hiccupped.
- **Target the canonical host.** If the apex 307-redirects to `www` (or vice versa), point the hook at the canonical URL — a 307 preserves method/body/headers so it works, but silently breaks if the redirect ever becomes 301/302 with a method downgrade.

**3. Volatile machine data leaves ISR entirely.** A status page baking minute-fresh rows (latencies, health checks) into ISR HTML writes genuinely new bytes every cycle. Make the page fully static (build-time snapshot as seed), fetch live data client-side from a **`force-dynamic` route handler with `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`**. CDN caching is free — zero ISR writes — and fresher than the ISR timer was. `force-dynamic` is mandatory there: a parameterless `GET()` without it gets prerendered and would serve a frozen build-time body forever.

## Verification

- `next build` route table: long TTLs shown per route (`1h`/`1d`), static routes show none; `.next/prerender-manifest.json` has the exact `initialRevalidateSeconds`.
- Hook semantics: wrong secret → 401, missing env → 503 (the 503 tells you the env var never reached the runtime — Vercel binds env at deploy time, so a variable saved mid-deploy needs a redeploy).
- CDN caching: request the SAME url twice and read `x-vercel-cache: MISS → HIT`. Do NOT append a cache-buster query param when testing — you'll fabricate a "caching is broken" finding. Also expected: Vercel **strips `s-maxage`/`stale-while-revalidate` from the client-facing header** while honoring them at the edge; the response header alone is not evidence of a missing cache.

## When this does NOT apply

- Pages that genuinely need per-request freshness: render them dynamic behind CDN headers instead of ISR — that's a latency/compute trade, not a writes trade.
- Paid plans where the write volume is a conscious cost (Pro: $4/1M writes) — then short TTLs are a legitimate simplicity choice.
- Pages Router `getStaticProps` has different mechanics; this covers the App Router.

## Provenance

Validated 2026-08 on a production Next.js 16.2.4 monorepo (marketing site + separate dashboard app on Vercel Hobby) that hit the 200k limit: ~90 sitemap-listed detail pages at `revalidate = 60` plus home/pricing at 60s. After the three moves above, the projected steady state is under 10k writes/month (~5% of the limit) with strictly better freshness after publishes (instant push instead of 60s poll).

Surface this from a symptom:

```js
search_lessons({ query: "vercel ISR writes limit rolling window revalidate on-demand", platforms: ["vercel"] })
```
