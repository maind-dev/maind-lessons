---
id: lsn_postgres_window_function_after_where_filter
title: "Diagnose silent LEAD/LAG bugs: Postgres window functions run AFTER WHERE"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: []
  languages: [sql]
  platforms: [postgres, supabase]
  tags: [postgres, window-function, lead, lag, evaluation-order, silent-bug]
summary: "Postgres evaluates window functions (LEAD, LAG, ROW_NUMBER, etc.) AFTER the WHERE clause. A `LEAD(col) OVER (...)` in a SELECT with a restrictive WHERE sees only post-filter rows, so `LEAD` resolves to the next row that ALSO passes the filter — not the next physical row. Workaround patterns: pre-compute the window in an unfiltered CTE then filter, a correlated subquery for `next matching row`, or a LATERAL join."
problem: |
  A CTE computes `LEAD(observed_at) OVER (PARTITION BY region ORDER BY observed_at) AS next_at`
  inside a SELECT with `WHERE event_type = 'start'`. The author intends `next_at`
  to mean "timestamp of the next event in the region (any type)" — but it resolves
  to "timestamp of the next START event", because the window function runs over
  the WHERE-filtered subset.

  Concrete failure case (status-monitoring system): `incident_starts` filtered to
  `from_status = 'operational'` with `LEAD(observed_at)` for `ended_at` produced
  durations of HOURS or DAYS instead of minutes — the "next row" was the NEXT
  incident's start, not the current incident's recovery event. The most recent
  incident per region was permanently reported as `ended_at = NULL` (still
  ongoing), because LEAD returned NULL on the partition's last filtered row.
solution: |
  Three patterns, pick the one that matches the query shape:

  ```sql
  -- Pattern 1: pre-compute LEAD in an unfiltered CTE, filter after
  WITH all_events AS (
    SELECT region, observed_at, event_type,
           LEAD(observed_at) OVER (PARTITION BY region ORDER BY observed_at) AS next_at
    FROM events
  )
  SELECT region, observed_at, next_at AS ended_at
  FROM all_events
  WHERE event_type = 'start';
  ```

  ```sql
  -- Pattern 2: correlated subquery for "next matching row"
  SELECT e.region, e.observed_at,
         (SELECT MIN(e2.observed_at)
          FROM events e2
          WHERE e2.region = e.region
            AND e2.observed_at > e.observed_at
            AND e2.event_type = 'end') AS ended_at
  FROM events e
  WHERE e.event_type = 'start';
  ```

  ```sql
  -- Pattern 3: LATERAL join (when multiple columns from the next row matter)
  SELECT e.region, e.observed_at, recovery.observed_at AS ended_at
  FROM events e
  LEFT JOIN LATERAL (
    SELECT observed_at FROM events e2
    WHERE e2.region = e.region AND e2.observed_at > e.observed_at AND e2.event_type = 'end'
    ORDER BY observed_at LIMIT 1
  ) recovery ON true
  WHERE e.event_type = 'start';
  ```
gotchas:
  - "Postgres SQL evaluation order: FROM → WHERE → GROUP BY → window functions → SELECT projection → DISTINCT → ORDER BY → LIMIT. Window functions running AFTER WHERE is standard SQL, but bites because the SELECT clause LOOKS like it operates on the same row set the window sees."
  - "ROW_NUMBER() OVER (ORDER BY ...) plus a WHERE is the most common variant — the row-number becomes per-filtered-subset, not over the full table. Pre-compute the row-number in a CTE for a global rank."
  - "If a WHERE is required for correctness (e.g. soft-delete filter), still pre-compute the window in an unfiltered CTE; the optimizer can usually push the WHERE down — verify with EXPLAIN."
  - "The bug is silent at small data sizes — with sparse data, LEAD often returns NULL whether the window is filtered or not, hiding the issue until production data fills in. Code-review catches it best at insertion time."
last_validated_at: "2026-05-28"
---

## How to spot this in code review

Look for any CTE / SELECT where:
1. A window function (LEAD, LAG, ROW_NUMBER, RANK, DENSE_RANK, FIRST_VALUE, LAST_VALUE, NTH_VALUE, aggregate-as-window) appears in the same SELECT as a WHERE clause that filters on a column referenced in the window's logic.
2. The author's comment or naming suggests the window should see "the next row" or "the previous row" in some BROADER sense than the filtered subset.

Heuristic grep:

```bash
# Find candidates in migrations / RPCs:
grep -B 2 -A 6 -E "LEAD\(|LAG\(|ROW_NUMBER\(|RANK\(" supabase/migrations/*.sql | \
  grep -B 4 "WHERE"
```

Each hit deserves a sanity-check: "If I remove the WHERE, does the window return the same value for the rows that DO pass the WHERE?" If no, the WHERE is changing the window's meaning.

## Verification snippet

```sql
-- Setup: events table with 4 rows
CREATE TEMP TABLE events_t (id int, kind text, observed_at timestamptz);
INSERT INTO events_t VALUES
  (1, 'start', '2026-01-01 12:00'),
  (2, 'end',   '2026-01-01 12:05'),
  (3, 'start', '2026-01-01 18:00'),
  (4, 'end',   '2026-01-01 18:02');

-- Buggy version: LEAD after WHERE
SELECT id, observed_at,
       LEAD(observed_at) OVER (ORDER BY observed_at) AS lead_at
FROM events_t
WHERE kind = 'start';
-- Returns: (1, 12:00, 18:00), (3, 18:00, NULL)
-- "lead_at" is the NEXT START, not the next event.

-- Correct version: pre-compute LEAD in a CTE, filter after
WITH all_events AS (
  SELECT id, kind, observed_at,
         LEAD(observed_at) OVER (ORDER BY observed_at) AS lead_at
  FROM events_t
)
SELECT id, observed_at, lead_at AS ended_at
FROM all_events
WHERE kind = 'start';
-- Returns: (1, 12:00, 12:05), (3, 18:00, 18:02)
-- "ended_at" is the next event (the recovery). Correct.
```

Run both forms in a Postgres console to feel the bug — the diff is immediate.

## Why this evaluation order exists

Window functions need a stable partition + order, which only makes sense after GROUP BY (if any) has fixed the row set. WHERE happens earlier because the optimizer benefits from filtering before any heavier per-row computation. The mental model "window functions look at the whole table" is wrong — they look at the rows that REACHED them in the pipeline, which is the WHERE-filtered set in single-query contexts.

## When this does NOT apply

- The WHERE only excludes rows that should be invisible to the window too. Example: `WHERE deleted_at IS NULL` plus `LEAD` over the non-deleted set — if the intent really is "next non-deleted row", the current code is correct.
- The window function operates on a column that is independent of the WHERE — e.g. `SUM(amount) OVER ()` (no PARTITION/ORDER) with `WHERE status = 'paid'` sums only paid amounts, which is usually what was intended.
- Single-row partitions: if PARTITION BY guarantees each partition has one row, LEAD/LAG always return NULL regardless of WHERE — no bug to surface.

If in doubt, run the verification snippet above with realistic data.

## Cross-references

- `lsn_postgres_function_overload_silent` — another silent-Postgres bug-class around CREATE OR REPLACE FUNCTION + changed signatures.
- `lsn_postgres_strict_mode_volatility` — strict-mode bites in a different way (STABLE/IMMUTABLE constraints), also discoverable only at hosted-DB time.
- `lsn_postgres_inlined_cte_correlated_subplan` — relevant when picking Pattern 2 (correlated subquery) above; the inlining behavior affects the cost analysis.
- `lsn_incident_list_min_duration_coalescing` — concrete consumer of this convention; the status-page incident-detection RPC where the original bug was caught.

## Tool-use example for agents

When designing or reviewing an RPC that uses window functions plus filtering:

```
search_lessons({
  query: "postgres window function LEAD LAG WHERE order",
  platforms: ["postgres"],
  tags: ["window-function"]
})
```

Then `get_lesson({id: "lsn_postgres_window_function_after_where_filter"})` for the full body before locking in the SQL shape.
