---
id: lsn_postgres_mv_exists_check_unpopulated
title: "Postgres MV: SELECT/EXISTS on unpopulated MV raises SQLSTATE 55000 — branch on pg_matviews.ispopulated"
type: debugging_lesson
tier: community
summary: "Postgres blocks every SELECT (including a trivial EXISTS) on a materialized view that has never been populated, raising SQLSTATE 55000 'materialized view has not been populated'. A common Cron-bootstrap pattern — `IF EXISTS (SELECT 1 FROM mv …) THEN REFRESH CONCURRENTLY ELSE REFRESH (initial) END IF` — fails inside the IF itself, so the initial-refresh branch is never reached. The correct populated-check uses pg_matviews.ispopulated from the system catalog, which is safe even on empty MVs."
context:
  languages: [sql]
  platforms: [postgres, supabase]
  tags: [postgres, materialized-view, mv, pg-cron, sqlstate-55000, bootstrap-pattern]
last_validated_at: "2026-05-29"
---
## The bootstrap-cron anti-pattern

A very common Cron pattern for refreshing a Postgres materialized view goes like this:

```sql
SELECT cron.schedule(
  'mv-refresh-nightly',
  '30 3 * * *',
  $cron$
  DO $body$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.my_mv LIMIT 1) THEN
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.my_mv;
    ELSE
      REFRESH MATERIALIZED VIEW public.my_mv;   -- initial-populate branch
    END IF;
  END;
  $body$;
  $cron$
);
```

The intent is: use `CONCURRENTLY` for everyday refreshes (allows concurrent reads), but fall back to a blocking initial refresh when the MV is brand-new and still unpopulated. The `EXISTS` was meant to be a cheap presence-check.

It fails. Postgres refuses every `SELECT` on an unpopulated MV — including `EXISTS (SELECT 1 …)`, including `SELECT count(*)`, including `SELECT 1 FROM mv LIMIT 1`. All of them raise:

```
SQLSTATE 55000
"materialized view has not been populated"
HINT: Use the REFRESH MATERIALIZED VIEW command.
```

The check itself is the failure. The ELSE branch is never reached. The MV stays unpopulated. The Cron fails every night with the same error — silently if you do not watch `cron.job_run_details`.

## How to detect this in your codebase

Audit any PL/pgSQL block, RPC, trigger, or Cron command that contains BOTH of:

```bash
grep -rn "MATERIALIZED VIEW" path/to/migrations
grep -rn "EXISTS (SELECT.*FROM.*mv_" path/to/migrations
grep -rn "SELECT.*FROM.*mv_.*LIMIT 1" path/to/migrations
```

Each hit where the SELECT/EXISTS targets a materialized view that could ever be unpopulated is a latent bug. The danger zone is anything that runs as a Cron, a migration's `DO $$` block, or a health check that reports MV status — these are exactly the call sites where an unpopulated state is plausible.

## The correct populated-check

Use the Postgres system catalog `pg_matviews`. It is a regular catalog view, populated whether the MV holds data or not:

```sql
DO $body$
BEGIN
  IF (SELECT ispopulated
      FROM pg_matviews
      WHERE schemaname = 'public'
        AND matviewname = 'my_mv') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.my_mv;
  ELSE
    REFRESH MATERIALIZED VIEW public.my_mv;
  END IF;
END;
$body$;
```

`pg_matviews.ispopulated` is boolean. `true` after the first successful (non-concurrent) `REFRESH`, `false` from `CREATE MATERIALIZED VIEW … WITH NO DATA` onwards until that first refresh lands.

## Detection in production

If your Cron has been failing in this pattern, `cron.job_run_details` is the smoking gun:

```sql
SELECT runid, status, return_message, start_time, end_time - start_time AS duration
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = '<your-job>')
ORDER BY start_time DESC
LIMIT 10;
```

Look for: `status = 'failed'`, `return_message` containing `materialized view … has not been populated`, and `duration` in the tens of milliseconds (the check is so fast it never gets close to a real refresh).

If you also have a client-side fallback path (e.g., a hook that reads from base tables when the MV is empty), the bug can hide for weeks or months — the UI works, but the MV never warms up. A downstream consumer that reads the MV directly (an RPC, a separate report) is what eventually surfaces it.

## Why this is non-obvious

Most developers reach for `EXISTS` as the cheapest possible "does this have data" check, transferring intuition from regular tables. Regular tables answer that question fine on zero rows: `SELECT EXISTS (SELECT 1 FROM regular_table)` returns `false` with no error. Materialized views are stricter: they refuse reads entirely until the first successful refresh. The strictness applies to `EXISTS`, `count(*)`, even `SELECT 1 FROM mv LIMIT 1` — the planner cannot serve any of them.

The catalog read (`SELECT ispopulated FROM pg_matviews …`) sidesteps that gate because it reads catalog metadata, not the MV itself.

## When this does NOT apply

- **Regular tables** — `EXISTS (SELECT 1 FROM regular_table)` is fine on zero rows, no error.
- **Views (non-materialized)** — these compute on read against base tables, they cannot be "unpopulated".
- **Foreign tables** — different access path, the unpopulated-MV gate does not apply.
- **MVs that are created with `WITH DATA`** (default) **AND** populated successfully on creation — for these the `EXISTS`-check works from migration time onwards. But this only holds as long as no one ever drops and recreates the MV `WITH NO DATA`. The defensive `pg_matviews.ispopulated` pattern survives that re-create; the `EXISTS` pattern does not.

If you can guarantee the MV is populated for the entire lifetime of the call site, `EXISTS` works. Most of the time you cannot, especially across migrations, region migrations, and disaster recovery — so the catalog-check is the safer default.

## Related Postgres patterns to audit at the same time

The same audit pass should also flag any:

- **Trigger** that does `SELECT … FROM my_mv` — the trigger fires on a base table change, the MV might still be empty.
- **View definition** that references the MV — the view query succeeds, but `SELECT * FROM my_view` fails the moment something touches the MV.
- **Function with STABLE / IMMUTABLE volatility** that reads the MV — these can be inlined by the planner into surprising places. See [[lsn_postgres_strict_mode_volatility]] and [[lsn_postgres_verify_live_function_body]] for adjacent volatility-driven failure modes.
- **`COMMENT ON MATERIALIZED VIEW`** is fine, but `pg_dump` of an unpopulated MV is also fine — the empty state can survive a restore.

The single defensive rule: never assume an MV is readable. Branch on `pg_matviews.ispopulated`, not on a probe read.

## Cross-references

- [[lsn_postgres_strict_mode_volatility]] — STABLE/IMMUTABLE functions reading MVs run into the same unpopulated trap when planner inlines them.
- [[lsn_postgres_verify_live_function_body]] — when debugging an MV-reading RPC, verify the live function body first.
- [[lsn_postgres_function_overload_silent]] — adjacent Cron / DO-block bug class.