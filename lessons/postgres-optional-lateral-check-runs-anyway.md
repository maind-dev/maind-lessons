---
id: lsn_postgres_optional_lateral_check_runs_anyway
title: "Diagnose an optional LATERAL check that still costs with its flag off — join filter and whole-row scan"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [sql]
  platforms: [postgres, supabase]
  tags: [postgres, lateral, query-planning, generic-plan, explain-analyze, security-definer, toast, performance]
summary: "A per-row LATERAL check gated on a flag (`left join lateral (select * from check(t) where p_flag) c on true`) still costs with the flag off. (1) In a generic plan the subquery is pulled up and `p_flag` becomes a join filter that runs after the function; `OFFSET 0` makes it a one-time filter. (2) Passing the whole row `t` makes the scan build full row values for every row it reads, before a join discards them; re-read the surviving rows by primary key instead."
problem: |
  A shared SQL/plpgsql reader serves two callers. One of them needs an
  extra per-row check (a hash recomputation, an ownership lookup, an
  expensive validation), the other does not. The obvious shape adds a flag
  and gates a LATERAL call on it:

      select ...
        from items t
        join visible v on v.owner = t.owner
        left join lateral (
          select * from check_item(t) where p_flag
        ) c on true;

  With p_flag = false you expect zero calls and zero extra cost. Measured,
  the flag-off path was several times slower than before the change, and
  a quick EXPLAIN with literal values showed nothing wrong.
solution: |
  Two independent fixes, both needed:

  1. Fence the subquery with `OFFSET 0`:

         left join lateral (
           select * from check_item(t) where p_flag offset 0
         ) c on true

     The flag stays inside the subquery and becomes a One-Time Filter on a
     Result node above the function scan; with the flag off the function is
     "never executed".

  2. Do not pass the whole row from the scanned table. Select the rows
     first, then re-read each surviving row by primary key inside the
     lateral and pass that:

         with sel as (select t.id, t.body from items t join visible v on v.owner = t.owner)
         select ...
           from sel s
           left join lateral (
             select x.* from items t2
              cross join lateral check_item(t2) x
              where t2.id = s.id and p_flag
             offset 0
           ) c on true;

     Within one statement every scan uses the same snapshot, so `t2` is the
     same row version whose columns `sel` returned.
---

## What actually happens

### 1. The gate turns into a join filter

`pull_up_subqueries` flattens the simple LATERAL subquery into the outer
join. Its `WHERE p_flag` no longer references anything inside the subquery,
so it lands on the nullable side of the LEFT JOIN as a **join filter**. A
nested loop evaluates a join filter per inner tuple, which means after the
inner side (the function scan) has already run:

```
Nested Loop Left Join (rows=60)
  Join Filter: $1
  Rows Removed by Join Filter: 60
  ->  Hash Join (rows=60)
        Hash Cond: (t.owner = v.owner)
        ->  Seq Scan on items t (actual time=0.043..5.220 rows=3000)
        ->  Hash -> Seq Scan on visible v (rows=1)
  ->  Function Scan on check_item (rows=1 loops=60)     <- runs with the flag off
```

With `OFFSET 0` the subquery is not pulled up, and the pseudo-constant qual
becomes a gate before the function scan:

```
Nested Loop Left Join (rows=60)
  ->  Hash Join (rows=60)
        ->  Seq Scan on items t (actual time=0.037..0.142 rows=3000)
        ->  Hash -> Seq Scan on visible v (rows=1)
  ->  Result (rows=0 loops=60)
        One-Time Filter: $1
        ->  Nested Loop (never executed)
              ->  Index Scan using items_pkey on items t2 (never executed)
              ->  Function Scan on check_item x (never executed)
```

(Both plans come from the verification script below, the second with both
fixes applied. Note the Seq Scan time in the first: that is effect 2.)

**Why a quick check misses it.** `EXPLAIN` with a literal `false`, or the
first five executions of a plpgsql function, use a *custom* plan. The planner
folds the constant and removes the subquery entirely. The bad shape exists
only in the *generic* plan, which plpgsql switches to after five calls
whenever it is not much more expensive. A call counter that ran once or
twice, or an EXPLAIN with literals, reports "zero calls" while production
pays on every row.

### 2. A whole-row argument is built by the scan, for every row it reads

`check_item(t)` needs the composite value of `t`. The planner computes it in
the **scan's target list**. Building a whole-row datum flattens the tuple, so
out-of-line (TOASTed) columns are fetched into it, for every row the scan
emits. A join afterwards discards most of those rows. Whether the function
ever runs does not matter: the row values are built before the gate.

Measured on PostgreSQL 17 with 3000 rows of ~4 KB TOASTed text, a join that
keeps 60 of them, and the flag off (function never executed):

| shape | Seq Scan time |
|---|---|
| no whole-row reference | 0.13 ms |
| `check_item(t)` next to the scan | 4.0–4.5 ms |
| re-read by primary key after the join | 0.17 ms |

The cost scales with **the table**, not with the caller's rows. In a
multi-tenant table, every tenant's call pays for every other tenant's rows.

## Verification

Reproduce both effects, then check your own function the same way:

```sql
BEGIN;
CREATE TABLE items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner int, body text, hash text);
INSERT INTO items (owner, body)
  SELECT s.i % 50, (SELECT string_agg(md5(random()::text || s.i || g.n), ' ') FROM generate_series(1, 125) g(n))
    FROM generate_series(1, 3000) s(i);
UPDATE items SET hash = md5(body);
CREATE TABLE visible (owner int PRIMARY KEY); INSERT INTO visible VALUES (7);
ANALYZE items; ANALYZE visible;
CREATE TYPE item_check AS (ok boolean, hash text);
CREATE FUNCTION check_item(p items) RETURNS item_check
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT CASE WHEN p.hash = md5(p.body) THEN row(true, p.hash)::item_check END
$f$;

SET plan_cache_mode = force_generic_plan;   -- what plpgsql ends up using

PREPARE bad(boolean) AS
  SELECT count(*), count(c.ok) FROM items t JOIN visible v ON v.owner = t.owner
  LEFT JOIN LATERAL (SELECT * FROM check_item(t) WHERE $1) c ON true;
EXPLAIN (ANALYZE, COSTS OFF) EXECUTE bad(false);   -- Join Filter: $1, Function Scan loops=60

PREPARE good(boolean) AS
  WITH sel AS (SELECT t.id FROM items t JOIN visible v ON v.owner = t.owner)
  SELECT count(*), count(c.ok) FROM sel s
  LEFT JOIN LATERAL (SELECT x.* FROM items t2 CROSS JOIN LATERAL check_item(t2) x
                      WHERE t2.id = s.id AND $1 OFFSET 0) c ON true;
EXPLAIN (ANALYZE, COSTS OFF) EXECUTE good(false);  -- One-Time Filter, never executed; cheap scan
ROLLBACK;
```

For a regression test inside a plpgsql function, count calls under a forced
generic plan:

```sql
SET LOCAL track_functions = 'all';
SET LOCAL plan_cache_mode = force_generic_plan;
-- c0 := calls from pg_stat_xact_user_functions for check_item
-- call the reader several times with the flag off
-- assert the call count did not change; then call once with the flag on
-- and assert it grew by the number of rows (proves the counter works)
```

## When this does not apply

- **The check is a plain expression in the select list** (no function scan in
  FROM). Then `CASE WHEN p_flag THEN expensive(...) END` short-circuits.
  Watch out, though: `(f(t)).*` or several `(f(t)).field` references can
  evaluate a composite-returning function once per field.
- **The function is inlinable** (`LANGUAGE sql`, not `SECURITY DEFINER`, no
  `SET` clause, a single `SELECT` without sublinks). Its body is then
  planned as part of the query, and the trade-offs change. A `SECURITY
  DEFINER` or `SET search_path` function is never inlined.
- **No TOASTed columns, or the filter is on the scanned table itself.** The
  whole-row cost is small when rows are narrow, or when the scan's own
  filter already drops the rows before the target list is computed. It
  bites when a join or semi-join does the filtering.
- **The re-read is split into a second statement.** The primary-key re-read
  relies on one snapshot per statement. Do not split it into two
  statements in a VOLATILE function: each statement takes a new snapshot
  under READ COMMITTED.

## Related

- `lsn_postgres_inlined_cte_correlated_subplan`: another way a per-row
  subplan runs more often than the query text suggests.
- `lsn_postgres_create_or_replace_validation_drift`: once you fix the shape,
  pin it with a drift guard (`offset 0` and the re-read are easy to "clean
  up" in a later refactor).

```text
search_lessons({ query: "lateral optional check join filter offset 0 generic plan whole-row", platforms: ["postgres"] })
```