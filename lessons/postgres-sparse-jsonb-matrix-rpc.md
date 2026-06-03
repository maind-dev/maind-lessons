---
id: lsn_postgres_sparse_jsonb_matrix_rpc
title: "Matrix/grid RPCs should return sparse non-zero cells — reconstruct the dense grid in the frontend"
type: convention
tier: community
summary: "When an RPC backs a fixed-axis 2D grid (hour×weekday punchcard, calendar heatmap, cohort grid), returning a fully gap-filled N×M matrix bloats the JSONB payload for no benefit. Return only the non-zero cells plus a max value; rebuild the full grid in the frontend render loop from the cell keys. The empty cells come from the loop, not the data."
context:
  tools: []
  languages: ["sql", "typescript"]
  platforms: ["postgres", "supabase"]
  tags: ["jsonb", "rpc", "data-visualization", "payload-size", "heatmap"]
---

A 2D grid visualization (a GitHub-style punchcard of hour-of-day × day-of-week, a calendar heatmap, a retention cohort grid) has a **fixed, client-knowable axis**: hours are `0..23`, ISO weekdays are `1..7`, the calendar is a known date range. The aggregation RPC should exploit that and return only what carries signal.

## The pattern

Group by the two dimensions, aggregate the non-zero cells only, and return a slim JSONB plus the max (for the intensity scale):

```sql
CREATE OR REPLACE FUNCTION public.get_usage_time_grid(p_days INT DEFAULT 28)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER          -- RLS applies; user sees only own rows
STABLE
SET search_path = public
SET statement_timeout = '15s'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_since   TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE 'UTC')
                           - make_interval(days => p_days - 1);
  v_result  JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  WITH cells AS (
    SELECT EXTRACT(isodow FROM (created_at AT TIME ZONE 'UTC'))::int AS dow,
           EXTRACT(hour   FROM (created_at AT TIME ZONE 'UTC'))::int AS hour,
           COUNT(*)                                                  AS calls
      FROM public.events
     WHERE user_id = v_user_id AND created_at >= v_since
     GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'days', p_days,
    'cells', COALESCE((SELECT jsonb_agg(
                         jsonb_build_object('dow', dow, 'hour', hour, 'calls', calls)
                         ORDER BY dow, hour) FROM cells), '[]'::jsonb),
    'max_calls', COALESCE((SELECT MAX(calls) FROM cells), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
```

## Frontend reconstructs the dense grid

The render loop owns the full N×M; the data only supplies the filled cells:

```tsx
const byKey = new Map<string, number>();
for (const c of grid.cells) byKey.set(`${c.dow}-${c.hour}`, c.calls);

// 7 rows × 24 columns, every slot rendered regardless of data:
DOW.map((label, row) =>
  HOURS.map((hour) => {
    const n = byKey.get(`${row + 1}-${hour}`) ?? 0;   // 0 if not in payload
    return <Cell key={hour} level={levelFor(n, grid.max_calls)} />;
  }),
);
```

## Why sparse beats a `generate_series` cross-join

A `generate_series(0,23) × generate_series(1,7)` LEFT JOIN materializes all 168 cells, most of them zero. For a typical user firing in a handful of slots, that is a 4–5× payload inflation that buys nothing: the zeros are produced by the render loop anyway. The JSONB width is also the smell that pushes an RPC toward the statement-timeout (see [[lsn_postgres_jsonb_rpc_timeout]]) — keep the payload proportional to the *signal*, not the grid size.

## When this does NOT apply

- The axis is **not** client-knowable (irregular buckets, server-defined groupings the client can't enumerate).
- The consumer is a dumb renderer that cannot do the key-lookup fill (e.g. a no-logic templating layer).
- You need server-side ordering/padding semantics the client can't reproduce.

For fixed numeric/temporal axes, none of these hold — return sparse.

## Related

- [[lsn_postgres_jsonb_rpc_timeout]] — JSONB width is the timeout smell; sparse keeps width down.
- [[lsn_supabase_authenticated_statement_timeout]] — set `statement_timeout` on the aggregation RPC.
- [[lsn_supabase_postgrest_row_limit_truncation]] — aggregate server-side instead of raw-selecting rows for the grid.

Discover this and neighbours: `search_lessons({ query: "jsonb rpc payload grid heatmap", platforms: ["postgres"] })`.
