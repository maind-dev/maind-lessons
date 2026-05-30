---
id: lsn_pgcron_self_unschedule_exception_rollback
title: Fix pg_cron crash-loop where EXCEPTION + RAISE rolls back the self-unschedule
type: debugging_lesson
tier: community
summary: A pg_cron job that calls cron.unschedule() in its own EXCEPTION-handler and then RAISEs to surface the error will see the unschedule rolled back together with the failed work — the job stays scheduled and re-runs forever. Fix is multi-statement (no DO-Block), inner BEGIN/EXCEPTION without RAISE, or RAISE NOTICE only.
context:
  tools: [pg_cron]
  languages: [sql]
  platforms: [postgres, pg_cron, supabase]
  tags: [pg_cron, transactions, exception-handling, infinite-loop, self-unschedule, materialized-view, subtransaction]
---

## Anti-Pattern

```sql
-- A bootstrap cron-job that should refresh once and self-unschedule on failure
DO $body$
BEGIN
  REFRESH MATERIALIZED VIEW public.my_mv;
  PERFORM cron.unschedule('mv-bootstrap');
EXCEPTION WHEN OTHERS THEN
  PERFORM cron.unschedule('mv-bootstrap');  -- WILL BE ROLLED BACK
  RAISE;
END $body$;
```

When `REFRESH` (or any wrapped operation) fails, control enters the EXCEPTION-branch. `PERFORM cron.unschedule(...)` runs inside the implicit subtransaction that the EXCEPTION-handler created. The subsequent `RAISE` re-throws — which rolls back that subtransaction, including the unschedule.

Net effect:

- The job stays scheduled.
- The error is logged.
- The next cron tick runs the same DO-Block again.
- Crash-loop forever — every minute (or whatever the schedule is).

## Why

PL/pgSQL EXCEPTION-handlers implicitly open a subtransaction. Everything you do in the handler is conditional on the subtransaction committing. `RAISE` re-throws an exception, which rolls the subtransaction back. There is no way to "keep" a side effect inside an EXCEPTION + RAISE branch — that is the entire purpose of subtransactions in pl/pgSQL.

The intuition "I will unschedule then re-raise so the cron-log captures the failure" is wrong because:

1. The unschedule is itself something the subtransaction must commit.
2. RAISE rolls the subtransaction back.
3. So the unschedule never persists.

## Fix Patterns

### A. Multi-Statement (no DO-Block) — preferred for simple cases

```sql
SELECT cron.schedule('mv-bootstrap', '* * * * *', $job$
  SET LOCAL statement_timeout = 0;
  REFRESH MATERIALIZED VIEW public.my_mv;
  SELECT cron.unschedule('mv-bootstrap');
$job$);
```

pg_cron runs each statement in its own transaction context. If REFRESH fails, the unschedule statement never runs (statements are sequential). If REFRESH succeeds, unschedule commits independently. Self-unschedule happens iff REFRESH succeeded.

### B. Inner BEGIN/EXCEPTION without RAISE

```sql
DO $body$
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW public.my_mv;
  EXCEPTION WHEN OTHERS THEN
    -- Just log; do NOT re-raise. unschedule then runs in outer tx.
    RAISE NOTICE 'REFRESH failed: %', SQLERRM;
  END;
  PERFORM cron.unschedule('mv-bootstrap');
END $body$;
```

Inner BEGIN/EXCEPTION wraps the failable work. The handler swallows the error (no RAISE). Outer block then unschedule cleanly. Cron tick sees the success, no retry.

### C. RAISE NOTICE only, no RAISE

```sql
DO $body$
BEGIN
  REFRESH MATERIALIZED VIEW public.my_mv;
  PERFORM cron.unschedule('mv-bootstrap');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'mv-bootstrap failed: %', SQLERRM;
  -- Optional: still unschedule on failure
  -- PERFORM cron.unschedule('mv-bootstrap');
END $body$;
```

`RAISE NOTICE` logs without re-throwing — outer transaction commits, and any side effect (including the optional unschedule in the EXCEPTION-branch) persists.

## When This Does NOT Apply

- The cron-callback has no EXCEPTION-handler at all. Errors then surface to cron-log naturally, no rollback puzzle.
- The cron-callback uses EXCEPTION but does NOT mutate `cron.job` (no unschedule/alter_job/schedule call). You can use RAISE freely — there is nothing to lose.
- The job is meant to retry forever on failure (e.g., a daily refresh-cron). The DO-Block-with-RAISE pattern is correct there because re-running is the intended behavior.
- Postgres without pg_cron (vanilla DDL/REFRESH inside an application transaction). The pattern is pg_cron-specific because pg_cron is what re-spawns the failed work.

## Detection & Gotchas

Already affected? Find at-risk jobs:

```sql
SELECT jobname, schedule, command
FROM cron.job
WHERE active = true AND command LIKE '%cron.unschedule%';
```

Look for DO-Blocks with EXCEPTION + RAISE. Check whether new runs keep starting:

```sql
SELECT pid, query, state, (now() - query_start)::text AS elapsed
FROM pg_stat_activity
WHERE query ILIKE '%my_mv%' AND state = 'active';
```

If you see repeated identical entries with fresh `query_start` timestamps, you are caught in the loop.

Gotchas:

- The same trap applies to any state-mutating pg_cron-helper called in EXCEPTION + RAISE: `cron.alter_job`, `cron.schedule`-with-overwrite, etc. — anything that writes to `cron.job` from inside the cron-callback.
- `statement_timeout = 0` is required for long REFRESHes inside DO-Blocks because `SET LOCAL` from outside doesn't propagate; the cron-spawned session uses the role default.
- On Supabase Cloud Free-Tier, REFRESH MATERIALIZED VIEW with `statement_timeout = 0` can run for hours — combine that with an EXCEPTION + RAISE self-unschedule and you have hours-long ghost jobs that spawn anew before the previous one finishes.

## References & Tool-Calls

```js
// Find via symptom-driven query
search_lessons({ query: "pg_cron infinite loop unschedule", platforms: ["pg_cron"] })

// Or via anti-pattern keyword
search_lessons({ query: "EXCEPTION RAISE cron.unschedule rollback" })

// Pull the full vetted convention once located
get_lesson({ id: "lsn_pgcron_self_unschedule_exception_rollback" })
```

- pg_cron docs: https://github.com/citusdata/pg_cron
- PL/pgSQL Trapping Errors: https://www.postgresql.org/docs/current/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING
- Related vetted convention: [[lsn_postgres_strict_mode_volatility]] — strict-mode runtime SQLSTATE patterns
