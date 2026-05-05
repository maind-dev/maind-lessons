---
id: lsn_0007_postgres_cte_correlated_subplan_reeval
title: "Inlined CTEs re-evaluate correlated SubPlans per usage site — a multi-CTE query can run the same subquery N times"
type: workflow_best_practice
tier: community
context:
  tools: [psql, supabase]
  languages: [sql, plpgsql]
  platforms: []
  tags: [postgres, performance, cte, query-plan, explain]
summary: "Postgres 12+ inlines CTEs by default. If a CTE contains a correlated subquery (a 'SubPlan' in EXPLAIN) and is referenced by multiple downstream CTEs, the SubPlan is re-evaluated once per reference — not shared. A single 3ms SubPlan over 700 rows referenced 3× becomes ~6 seconds, with the EXPLAIN showing duplicate `SubPlan N` nodes."
problem: |
  A multi-CTE RPC that reads cleanly takes 5–10× longer than the table sizes
  suggest. The query looks like:
  ```sql
  WITH base AS (
    SELECT b.*,
           (SELECT rate FROM fx WHERE fx.date = b.date AND fx.ccy = b.ccy) AS rate_eur
    FROM big_table b
    WHERE b.user_id = $1
  ),
  filtered AS ( SELECT * FROM base WHERE rate_eur IS NOT NULL ),
  conflicts AS ( SELECT * FROM base WHERE rate_eur IS NULL )
  SELECT * FROM filtered UNION ALL SELECT * FROM conflicts;
  ```
  EXPLAIN ANALYZE shows two or three nodes named `SubPlan 7`, `SubPlan 8`,
  `SubPlan 9`, each with similar `loops=` counts and similar bodies. The
  total time is dominated by their sum.
solution: |
  Two distinct fixes, choose based on the SubPlan's own cost:

  **(1) Make the SubPlan cheap (preferred).** If you have control of the
  schema, add a functional or composite index that makes the subquery a
  single index lookup:
  ```sql
  CREATE INDEX fx_date_ccy_idx ON fx (date, ccy) INCLUDE (rate);
  ```
  Now even three re-evaluations per row of `base` cost microseconds. The
  re-evaluation is no longer the bottleneck and you don't change the query.

  **(2) Force materialization.** If the SubPlan is intrinsically expensive
  and can't be index-accelerated, pin the CTE so Postgres evaluates it
  exactly once and stores the result:
  ```sql
  WITH base AS MATERIALIZED (
    SELECT ... (correlated subquery) ...
  ),
  filtered AS ( SELECT * FROM base WHERE ... ),
  conflicts AS ( SELECT * FROM base WHERE ... )
  ...
  ```
  `MATERIALIZED` was the implicit default in Postgres ≤ 11 and remains the
  explicit opt-in in 12+. It costs a sort/buffer, which is usually
  worthwhile only when the SubPlan's per-row cost dominates the materialize
  overhead.

  **Diagnosis pattern.** In the EXPLAIN output, count `SubPlan N` nodes.
  If the same body appears more than once with similar `loops=`,
  multiply per-row cost × loops × duplicate-count to estimate the
  re-evaluation tax. That number tells you whether option 1 or option 2
  is worth it.
gotchas:
  - "EXPLAIN without ANALYZE shows the SubPlan structure but not the actual loops/timing — always use `EXPLAIN (ANALYZE, BUFFERS)` when chasing this."
  - "MATERIALIZED is not free. For small CTEs that are referenced once or twice, the materialize buffer is *more* expensive than re-evaluating an inlined subquery. Measure both."
  - "Functional or covering indexes on the correlated columns often dominate either CTE strategy. If the SubPlan is `SELECT x FROM t WHERE t.a = outer.a`, a `(a, x)`-covering index makes 3 re-evals indistinguishable from 1."
  - "Don't refactor the query into a single big SELECT just to avoid CTEs. Postgres can plan multi-CTE queries well — the issue is specifically *correlated subqueries inside a referenced-multiple-times CTE.*"
  - "Postgres ≤ 11 treated CTEs as optimization fences (always materialized), so this trap is *new* code you write on 12+ — older code may have been quietly fast for the wrong reason."
evidence: "Postgres docs: https://www.postgresql.org/docs/current/queries-with.html (CTE inlining vs. MATERIALIZED). EXPLAIN's `SubPlan` node is described in https://www.postgresql.org/docs/current/using-explain.html."
last_validated_at: "2026-05-05"
tool_versions:
  postgres: "12.x, 13.x, 14.x, 15.x, 16.x"
upvotes: 0
---

# Background

Postgres 12 changed the CTE default from "always materialize" to "inline if
not used multiple times." That change unblocks the planner for the common
case (one-shot helper CTE), but it has a sharp edge: if a CTE *is*
referenced multiple times, inlining duplicates *everything* in its body —
including correlated SubPlans that the planner would have happily reused
from a materialize buffer.

The result is a class of query that looks fine, runs fine on a small data
set, and degrades quadratically (or worse) as the row count grows.

## Diagnosing pattern

For any multi-CTE query that is "slower than it should be":

1. `EXPLAIN (ANALYZE, BUFFERS) <query>;`
2. Count `SubPlan N` nodes. Group by similar bodies.
3. Sum `loops × per-row cost` across duplicates.

If the duplicated SubPlans dominate the total time, decide between the two
fixes above. Don't pre-emptively `MATERIALIZED` everything — that costs
buffers and silently breaks predicate-pushdown opportunities that the
planner would otherwise use.

## When to materialize even without the multi-reference issue

`MATERIALIZED` is also the right tool when:
- The CTE has side effects (`INSERT INTO ... RETURNING`) that must run exactly
  once.
- A downstream consumer is `EXISTS (SELECT 1 FROM cte ...)` and you want to
  prevent the planner from pushing the existence test inside the CTE body.
- You want to debug-isolate a CTE's plan in EXPLAIN output (materialize
  forces a clear boundary).

For pure read-only correlated-SubPlan-amplification, prefer the index fix
first.

## A simple mnemonic

> **CTE referenced once → inline (free).
> CTE referenced N>1 with a SubPlan inside → either index the SubPlan or
> MATERIALIZE the CTE.
> Everything else → measure.**
