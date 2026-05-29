---
id: lsn_supabase_in_clause_url_chunking
title: Fix Supabase `.in()` URL overflow — PostgREST passes IDs in the URL and crosses 8KB at ~30 items
type: debugging_lesson
tier: community
lesson_class: architecture
quality_tier: hand-vetted
context:
  tools:
    - supabase
    - postgrest
  languages:
    - typescript
    - javascript
  platforms:
    - supabase
  tags:
    - postgrest
    - url-limit
    - batching
    - "http-414"
summary: Supabase's `.in("col", arr)` serialises the array into the URL as `?col=in.(v1,v2,v3,...)`. With ~30+ items (and typical UUID/ISIN lengths), the URL crosses ~8KB and the edge gateway returns 414 URI Too Long or a generic 400. Chunk the array client-side or move to a SECURITY DEFINER RPC that takes the array as POST body.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The symptom

A query that works for small inputs fails for large ones with one of:

- HTTP `414 URI Too Long`
- HTTP `400 Bad Request` with no body or a vague "invalid request" message
- `fetch` throws `TypeError: Failed to fetch` (browser-side, when the URL
  exceeds the browser's 2KB hard limit before even reaching the server)

The Supabase client doesn't surface this as a typed error — the call
fails opaquely. Logs show the URL contains a giant comma-separated list:

```
GET /rest/v1/instruments?id=in.(uuid-1,uuid-2,uuid-3,...,uuid-247)
```

## What's actually happening

`.in("col", arr)` is a PostgREST-style query parameter — it goes in the
URL, not the request body. Each item is URL-encoded, comma-separated,
wrapped in `in.(...)`. With:

- 30 UUIDs (36 chars each + comma): ~1.1KB just for the list
- 30 ISINs (12 chars each + comma): ~400B
- 100 long strings (e.g., 60-char user IDs): ~6KB+

Plus the rest of the URL (base, schema, filters, select), you cross the
edge gateway's typical 8KB URI limit at 30-200 items depending on item
length. Cloudflare/nginx-fronted Supabase projects often have a lower
limit than self-hosted PostgREST.

The query plan itself would have run fine — Postgres has no problem
with `WHERE col = ANY ($1)` on thousands of values. The bottleneck is
the HTTP transport layer.

## The fix

### Option A — client-side chunking

Split the array, fire multiple queries in parallel, merge results:

```typescript
const CHUNK_SIZE = 30;
const chunks: string[][] = [];
for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
  chunks.push(ids.slice(i, i + CHUNK_SIZE));
}
const results = await Promise.all(
  chunks.map((chunk) =>
    supabase.from("instruments").select("*").in("id", chunk)
  )
);
const rows = results.flatMap((r) => r.data ?? []);
```

Pick the chunk size so that `CHUNK_SIZE × avg_item_length` stays under
1KB. UUIDs → 25-30. Short slugs → 100+. Be conservative on the first
deploy; profile real URL lengths in production logs before tightening.

### Option B — SECURITY DEFINER RPC

For queries you run often, define an RPC that accepts the array as a
JSON body parameter (POST instead of GET — body, not URL):

```sql
CREATE OR REPLACE FUNCTION public.instruments_by_ids(p_ids uuid[])
RETURNS SETOF public.instruments
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.instruments WHERE id = ANY (p_ids);
$$;
```

```typescript
const { data, error } = await supabase.rpc("instruments_by_ids", {
  p_ids: ids,
});
```

The POST body has no practical size limit at the gateway. This is the
right answer for batch sizes >100 or queries that need to join multiple
tables before returning.

## When this does not apply

- If `arr.length <= 20` and items are short (UUIDs or shorter), the URL
  stays under 1KB — no chunking needed.
- If your filter is "all rows where col matches a pattern" rather than
  "all rows where col is in a specific list," use `.like()` or `.match()`
  instead. The URL stays bounded.
- For unbounded list growth (e.g., user-supplied selection), move to RPC
  immediately — client-side chunking eventually fails when the input
  itself grows beyond what's reasonable to fetch.

## Verification

```typescript
// Lab — measure where the 414 trips
async function probe(n: number) {
  const ids = Array.from({ length: n }, (_, i) => crypto.randomUUID());
  const { error } = await supabase.from("instruments").select("id").in("id", ids);
  return error ? `${n}: ${error.message}` : `${n}: ok`;
}
for (const n of [20, 50, 100, 200, 400]) console.log(await probe(n));
```

The first `n` that returns an error is your chunk-size ceiling. Set
`CHUNK_SIZE` to half that value.

## Gotcha — the error surfaces in `error`, not as a throw

```typescript
const { data, error } = await supabase.from("…").in("id", ids);
if (error) {
  // 414 lands here, not in a try/catch
  console.error(error);
}
```

If you wrote `await supabase.from("…").in(...)` without destructuring
`{ data, error }`, the 414 is silently swallowed and `data` is `null`.
Always destructure both.
