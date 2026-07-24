---
id: lsn_postgres_timeseries_gap_fill_aggregate
title: "Aggregate chart time-series server-side with a gap-filled generate_series — don't raw-select rows and bucket in app code"
type: convention
tier: community
summary: "For a heatmap / sparkline / calendar over weeks-to-months of events, do NOT select the raw rows and bucket them in app code: PostgREST silently truncates at 1000 rows (a wrong chart with no error), and missing periods leave gaps the UI must special-case. Aggregate in Postgres, gap-fill the period axis with a generate_series LEFT JOIN, and return a slim ordered JSONB the client renders directly."
context:
  tools: []
  languages: ["sql", "typescript"]
  platforms: ["postgres", "supabase"]
  tags: ["time-series", "data-visualization", "generate-series", "aggregation", "postgrest"]
---

A chart over "the last N days" tempts a raw read — `select created_at from events where created_at >= since` — then a `reduce` in app code to count per day. Two things break.

## Two failure modes of the raw-select approach

1. **Silent truncation.** PostgREST caps responses at `max_rows` (default 1000). A busy user over 90 days blows past it; the client receives 1000 rows with no error and the chart is quietly wrong (see [[lsn_supabase_postgrest_row_limit_truncation]]).
2. **Gaps.** Days with zero events have no rows at all, so the client has to invent the missing buckets — exactly the logic the database can do once, correctly.

## The pattern: aggregate + gap-fill in Postgres

Bucket with `date_trunc`, then LEFT JOIN onto a dense `generate_series` of the period so every bucket exists (zero when empty):

```sql
WITH days AS (
  SELECT generate_series(
           date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => p_days - 1),
           date_trunc('day', now() AT TIME ZONE 'UTC'),
           interval '1 day')::date AS day
),
counted AS (
  SELECT (created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*) AS calls
    FROM public.events
   WHERE user_id = auth.uid() AND created_at >= (now() - make_interval(days => p_days))
   GROUP BY 1
)
SELECT jsonb_agg(
         jsonb_build_object('day', d.day, 'calls', COALESCE(c.calls, 0))
         ORDER BY d.day)
  FROM days d LEFT JOIN counted c USING (day);
```

Wrap it in a `SECURITY INVOKER` function with `SET statement_timeout` (the `authenticated` role's default is short — see [[lsn_supabase_authenticated_statement_timeout]]). The client gets a dense, ordered series it renders directly — no truncation, no gap-handling.

## When this does NOT apply

- The window is small and bounded (a few hundred rows max) AND you need the raw event detail anyway — a direct read is simpler.
- You need per-event drill-down, not counts — then paginate the raw read with `.range()`, don't aggregate.

## Related

- [[lsn_supabase_postgrest_row_limit_truncation]] — the silent-truncation failure this avoids.
- [[lsn_postgres_jsonb_rpc_timeout]] — keep the aggregated JSONB slim so it doesn't hit the statement timeout.

Discover neighbours: `search_lessons({ query: "time series aggregation chart generate_series gap fill", platforms: ["postgres"] })`.
