---
id: lsn_0006_postgres_stable_volatility_mismatch
title: "STABLE/IMMUTABLE Postgres functions cannot contain CREATE TEMP TABLE / DML — runtime SQLSTATE 0A000 in strict configs"
type: debugging_lesson
tier: community
context:
  tools: [supabase, psql]
  languages: [sql, plpgsql]
  platforms: []
  tags: [postgres, plpgsql, volatility, stable, immutable, runtime-error]
summary: "Marking a plpgsql function STABLE or IMMUTABLE is a contract that the body does not modify the database. Bodies that contain CREATE TEMP TABLE, TRUNCATE, INSERT, UPDATE or DELETE violate that contract. Stricter Postgres configurations (newer minor versions, certain managed regions) raise SQLSTATE 0A000 'CREATE TABLE is not allowed in a non-volatile function' at call time, where laxer configs let it through."
problem: |
  A function deployed and tested fine for months in one environment:
  ```sql
  CREATE OR REPLACE FUNCTION compute_summary(p_user uuid)
  RETURNS TABLE (period date, total numeric)
  LANGUAGE plpgsql
  STABLE
  AS $$
  BEGIN
    CREATE TEMP TABLE _scratch (period date, total numeric) ON COMMIT DROP;
    INSERT INTO _scratch SELECT ...;
    RETURN QUERY SELECT period, total FROM _scratch ORDER BY period;
  END $$;
  ```
  After moving to a new region (or upgrading to a newer Postgres minor) the
  same function call raises:
  ```
  ERROR:  CREATE TABLE is not allowed in a non-volatile function
  CONTEXT:  SQL statement "CREATE TEMP TABLE _scratch ..."
  PL/pgSQL function compute_summary(uuid) line 3 at SQL statement
  SQLSTATE: 0A000
  ```
  No code or schema changed — only the runtime configuration's strictness.
solution: |
  Either remove the DDL/DML from the body, or relax the function's
  volatility marker to match what it actually does.

  In most cases, the right fix is the volatility marker:
  ```sql
  ALTER FUNCTION public.compute_summary(uuid) VOLATILE;
  ```
  `VOLATILE` is the default — it expresses "this function may modify
  database state." For a function that creates a temp table or runs
  DML, this is the truth.

  When writing a new function, omit the volatility keyword unless you are
  *sure* the body is read-only:
  ```sql
  -- read-only, IMMUTABLE-safe
  CREATE OR REPLACE FUNCTION normalize_sym(s text)
  RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT upper(trim(s));
  $$;

  -- read-only with DB lookups, STABLE-safe
  CREATE OR REPLACE FUNCTION find_user_by_email(p_email text)
  RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT id FROM users WHERE email = p_email;
  $$;

  -- writes / temp tables / DML → VOLATILE (omit keyword)
  CREATE OR REPLACE FUNCTION recompute_snapshots()
  RETURNS void LANGUAGE plpgsql AS $$ ... $$;
  ```

  Note: STABLE/IMMUTABLE allow planner inlining and call-time elimination,
  which can be a real performance win — but only for genuinely pure
  bodies. A function with a `FOR ... LOOP` or `RAISE EXCEPTION` is rarely
  inlined anyway, so demoting to VOLATILE is usually a no-cost fix.
gotchas:
  - "Postgres does not refuse to *create* a STABLE function with DDL in its body. The error is raised at *call* time. So the bug can sit dormant in version-controlled SQL until the strict configuration sees it."
  - "Symptoms are environment-specific. London and Frankfurt managed Postgres regions have shipped with different strictness defaults at different times. Self-hosted Postgres minor upgrades (e.g. 15.4 → 15.6) have also changed the boundary."
  - "Marking the function VOLATILE does not break anything else — VOLATILE is the default and the most permissive marker. It only loses planner-level inlining/dedup, which a function with a temp-table body never had anyway."
  - "Don't 'fix' this by removing the temp table just to keep STABLE — that's a major rewrite. Match the marker to the body."
evidence: "Postgres docs on function volatility: https://www.postgresql.org/docs/current/xfunc-volatility.html. SQLSTATE 0A000 = `feature_not_supported`."
last_validated_at: "2026-05-05"
tool_versions:
  postgres: "14.x, 15.x, 16.x"
upvotes: 0
---

# Background

Postgres function volatility (`VOLATILE`, `STABLE`, `IMMUTABLE`) is a
**promise to the planner**, not a property the planner derives. The planner
takes the keyword at face value — it will inline, fold, and reorder calls
based on the volatility marker. Body content that breaks the promise is
caught only by runtime guards, and those guards have tightened over recent
Postgres versions.

The lesson for AI coding agents: when generating or editing a plpgsql
function, the safe default is to **omit** the volatility keyword (which
defaults to `VOLATILE`). Add `STABLE` or `IMMUTABLE` only if the body
is unambiguously side-effect-free.

## Decision rule

| Body contains | Correct marker |
|---|---|
| Pure expression (math, string ops, no DB lookups) | `IMMUTABLE` |
| DB reads (`SELECT` from tables) only | `STABLE` |
| `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` | `VOLATILE` (default) |
| `CREATE TEMP TABLE` / `DROP TABLE` / any DDL | `VOLATILE` (default) |
| Calls another function that is `VOLATILE` | `VOLATILE` (default) |
| `RAISE NOTICE` / `RAISE EXCEPTION` | irrelevant — keep whatever fits the rest |

`RAISE` itself does not change volatility, but a function that raises is rarely
a candidate for inlining anyway.

## Migration recipe

When you discover this in production and need a fix that is small and
reviewable:

```sql
-- migration_<timestamp>_relax_compute_summary_volatility.sql
ALTER FUNCTION public.compute_summary(uuid) VOLATILE;
```

That is the entire fix. No body changes, no behavior change, no performance
regression for functions that already use temp tables (which would never have
been inlined anyway).

## Related

- "Frankfurt strict-mode" Postgres also tightens behavior around
  `DELETE FROM x` without `WHERE` (raises `21000`) and around
  `RETURNS TABLE` column-name collisions with referenced tables
  (raises `42702`). Volatility-mismatch is in the same family of
  "code that worked elsewhere now fails at call time."
