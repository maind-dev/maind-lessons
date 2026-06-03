---
id: lsn_postgres_distinct_on_lateral_latest_per_group
title: "DISTINCT ON scans the whole table for \"latest row per group\" — use LATERAL over the known key list"
type: debugging_lesson
tier: community
summary: "SELECT DISTINCT ON (k) ... ORDER BY k, ts DESC scales with table size, not with the number of distinct keys: Postgres (< v18) has no loose-index/skip-scan, so it walks every index entry and de-duplicates. When the key set is small and known, a LATERAL join over that key list does one index-seek per key — O(keys) instead of O(rows)."
context:
  tools: []
  languages: [sql]
  platforms: [postgres]
  tags: [postgres, query-performance, distinct-on, lateral, explain-analyze, latest-per-group]
---

## The pattern that looks fine but scales badly

A very common need: "the most recent row per <key>" — latest status per service, latest price per symbol, latest event per user. The idiomatic form:

```sql
SELECT DISTINCT ON (service)
  service, status, latency_ms, checked_at
FROM service_checks
ORDER BY service, checked_at DESC;
```

With an index on `(service, checked_at DESC)` this *looks* index-backed, and on a small table it is fast. The trap: its cost grows with the **number of rows**, not with the **number of distinct keys**. Postgres (through v17) has no "loose index scan" / skip-scan for `DISTINCT ON`, so it walks the whole index and applies a Unique node. A table that grows by thousands of rows/day makes this query slowly heavier even though it always returns the same handful of rows.

## The EXPLAIN smell

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM your_distinct_on_query;
```

Watch `Buffers: shared hit=`. For a 5-group / ~60k-row table the `DISTINCT ON` form showed **3536 buffer hits to return 5 rows** — the buffer count tracks the table, not the result. That ratio (thousands of buffers for a few rows) is the signal.

## The fix: LATERAL over the known key list

When the keys are a small, known set, drive the query from the keys and do one indexed `ORDER BY ... LIMIT 1` per key:

```sql
SELECT c.*
FROM unnest(ARRAY['app','database','auth','market_data','payments']) AS k(key)
CROSS JOIN LATERAL (
  SELECT status, latency_ms, checked_at
  FROM service_checks sc
  WHERE sc.service = k.key
  ORDER BY sc.checked_at DESC
  LIMIT 1
) c;
```

Same index `(service, checked_at DESC)`, but now each key is a single seek. Verified on the same table: **15 buffer hits, 0.16 ms** (down from 3536 hits / 18 ms warm) — and, crucially, **constant** as the table grows. If the key set is dynamic, source it from a small lookup/dimension table (or `SELECT DISTINCT key` on an indexed column) and LATERAL-join the same way.

## When this does not apply

- The table is small and stays small (config-like tables) — `DISTINCT ON` is fine and more readable.
- You genuinely need de-dup over a *large* result, not just the latest-per-key tail.
- You're on Postgres 18+ where skip-scan support changes the calculus — re-check the plan rather than assuming.
- The key set is large or unbounded (then the per-key seek count itself becomes the cost; window-function `ROW_NUMBER()` may win).

## Why it matters beyond raw speed

The dangerous version isn't "slow" — it's "slowly getting slower". A query that is 18 ms today and 18 ms in EXPLAIN can still be the hidden driver of a metric that creeps up over weeks, because the buffer-scan cost rises with retention while warm-cache timing hides it. If a per-key "latest" read sits on a hot path (health probe, dashboard, polling), prefer the LATERAL form from the start.

## For agents

```text
search_lessons({ query: "DISTINCT ON slow latest row per group lateral", platforms: ["postgres"] })
get_lesson({ id: "lsn_postgres_distinct_on_lateral_latest_per_group" })
```

Related: `lsn_postgres_inlined_cte_correlated_subplan`, `lsn_postgres_jsonb_rpc_timeout`.
