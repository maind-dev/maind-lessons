---
id: lsn_postgres_lateral_without_from_pulled_up
title: "Postgres RPC slows as a table grows: per-row LATERAL or CTE work runs over the whole set"
type: debugging_lesson
tier: community
summary: "A LATERAL subquery without FROM is pulled up by the planner and evaluated in the scan of the large side, once per row, before the join narrows to the matched rows. A non-inlinable function (SECURITY DEFINER or SET search_path) in a CTE read twice is likewise computed for every materialized row. Cost tracks the table, not the request. Confirm via EXPLAIN, compute the set first and call once, and guard with a test that counts calls."
context:
  tools: []
  languages: [sql]
  platforms: [postgres, supabase]
  tags: [postgres, performance, query-planning, lateral, cte, explain-analyze, function-inlining, testing]
last_validated_at: "2026-11-19"
version: 1
---

## Symptom

An RPC that answers about a handful of rows gets slower week by week. Nothing in the result changes; the latency tracks the size of a table the caller barely touches. In the incident behind this entry:

- a "my work items" RPC returned 1 matched object and took **5.1 s**, at 1,480 visible objects;
- a presence RPC returned at most 50 recent events and took **1.6–2.4 s**, at 2,411 events.

Both comments in the code said the expensive part was "bound to the matched rows". The plan said otherwise.

## Two mechanisms

### 1. A LATERAL without FROM is pulled up

```sql
SELECT …, pr.open_pr
  FROM matched m
  JOIN visible_objects w ON w.id = m.object_id          -- 1,480 rows, hash join
  LEFT JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM open_pr_ids(ARRAY[w.id])) AS open_pr
  ) pr ON true;
```

A subquery without FROM is a plain expression to the planner. It flattens it into the target list, and on the nullable side of a LEFT JOIN that expression is evaluated where its inputs first exist: **in the scan of `visible_objects`, for every row**, before the hash join keeps the one that matched. Here that was 1,480 × 3.4 ms. LATERALs with a real FROM (a function scan, a table) in the same query stayed above the join and were cheap.

### 2. A materialized CTE computes a per-row function for rows it later drops

```sql
WITH ev AS (                                   -- read twice below ⇒ materialized
  SELECT e.*, scope_prefix(w.org_id, w.team_id) || '-' || w.seq AS object_key
    FROM events e JOIN objects w ON w.id = e.object_id
   WHERE is_visible_to(e.object_id, :user)     -- SQL function with SET search_path
),
landed AS (SELECT * FROM ev WHERE … ORDER BY at DESC LIMIT 25),
opened AS (SELECT * FROM ev WHERE … ORDER BY at DESC LIMIT 25)
SELECT … FROM landed UNION ALL SELECT … FROM opened;
```

Since PG 12 a CTE referenced more than once is materialized, so every expression in it is computed for every row it holds (2,411 here), although only 50 survive. Two things make it expensive:

- functions that are SECURITY DEFINER or carry `SET search_path` are **never inlined**, so each row is a full function call;
- a visibility helper called per row (`is_visible_to(id, user)`) re-evaluates the same user-level inputs (org id, team set) on every call.

## How to confirm

1. `EXPLAIN (ANALYZE, BUFFERS)` the RPC's statement with real parameters. The smell: a `SubPlan` containing the function call hanging **under the scan of the large relation**, with `loops` equal to that relation's row count, or a `CTE Scan` whose time is far larger than the rows the query returns.
2. Prove it with a fence before refactoring: add `OFFSET 0` inside the LATERAL subquery (it blocks the pull-up). In the incident: **5,177 ms → 75 ms**.
3. If the function is non-inlinable, `SELECT provolatile, prosecdef, proconfig FROM pg_proc WHERE proname = …` shows why (`prosecdef = t` or a non-null `proconfig`).

## Fix

- **Compute the set first, call once on the whole set.** Materialize the matched ids, call the function with the array once, join the result:

  ```sql
  matched_set AS MATERIALIZED (SELECT object_id FROM … GROUP BY object_id),
  open_pr     AS MATERIALIZED (
    SELECT op AS object_id FROM open_pr_ids(ARRAY(SELECT object_id FROM matched_set)) op)
  …
  LEFT JOIN (SELECT object_id, true AS open_pr FROM open_pr) pr ON pr.object_id = w.id
  -- and COALESCE(pr.open_pr, false) where the old EXISTS returned false
  ```

- **Evaluate per-user inputs once** and put the visibility rule on the joined row instead of calling the helper per row:

  ```sql
  v_org   := user_org_id(:user);
  v_teams := ARRAY(SELECT visible_team_set(:user));
  … WHERE (w.team_id IS NULL AND w.org_id = v_org) OR w.team_id = ANY(v_teams)
  ```

  Copy the helper's predicate verbatim, including its NULL behaviour and what it does *not* filter (e.g. archived rows).
- **Compute per-row derived values only for the rows you keep.** Move the key formatting out of the materialized CTE into the final SELECT over the ≤ 50 picked rows, and resolve per-scope values once per distinct scope (`SELECT DISTINCT org_id, team_id …`).

Measured after the change in production: 6.6 s → 0.14 s and 2.2 s → 0.09 s.

## Guard it — a result test cannot see this regression

The answer is identical before and after, so every result-based test stays green when a later `CREATE OR REPLACE` copies the old body back in. Count the work instead:

```sql
SET LOCAL track_functions = 'all';
-- calls of a function in this transaction:
SELECT sum(calls) FROM pg_stat_xact_user_functions
 WHERE schemaname = 'internal' AND funcname = 'is_visible_to';
-- reads of a table (one per built row, if the code reads it per row):
SELECT seq_scan + idx_scan FROM pg_stat_xact_user_tables WHERE relname = 'path_anchor';
```

Assert **growth, not an absolute number**: call the RPC, add a few hundred more rows, call again, and require the count to stay the same. An absolute `= 0` failed on a shared clean test database because an unchanged helper made the same call for other sessions' data left behind by other test scripts.

Verify the test bites: inject the old per-row form back into a copy of the migration and confirm the counting assertion fails. Also compare old vs new output once on a large fixture, including ties in ORDER BY, before trusting the rewrite.

## When this does NOT apply

- The LATERAL has a FROM clause (function scan, table): it is not flattened into the target list; check the plan anyway, but this mechanism is not it.
- The function is inlinable (plain `LANGUAGE sql`, not DEFINER, no SET): the planner can turn it into a join or semi-join; the per-row call cost disappears even when the shape looks per-row.
- The CTE is referenced once: since PG 12 it is inlined, and filters can push down into it.
- The large side really is the result (you need the value for every row): then the cost is honest, and the fix is an index, a cache or a rollup, not a reshaped query.

### Related

- [[lsn_postgres_inlined_cte_correlated_subplan]] — the sibling: a correlated subquery inside a CTE re-evaluated per consumer. Here the CTE is evaluated once, but for far too many rows.
- [[lsn_postgres_distinct_on_lateral_latest_per_group]] — same family of "cost tracks the table, not the result", with a scan instead of a function.

```js
search_lessons({ query: "lateral without from pulled up per row before join function scan whole set", platforms: ["postgres"] })
```
