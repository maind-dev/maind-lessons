---
id: lsn_incident_list_min_duration_coalescing
title: "Filter status-page incident lists at the SQL layer: drop sub-threshold flaps, coalesce near-adjacent windows"
type: workflow_best_practice
tier: community
lesson_class: architecture
context:
  tools: []
  languages: [sql]
  platforms: [postgres]
  tags: [status-page, monitoring, incident-detection, signal-noise, window-function, coalescing]
summary: "Incident lists derived from raw probe events are dominated by sub-minute flaps and by paired start/end entries that read as two events but represent one. Two SQL filters in the detection RPC keep the list focused: drop incidents shorter than ~2× probe interval, and coalesce consecutive incidents per target with gap below ~10 min (deploy-phase span) into one window. RPC-layer filtering keeps single-source-of-truth across UI, JSON API, and notifier consumers."
problem: |
  A status page or monitoring dashboard reads from a probe-event table
  via a "detect status changes" RPC. The RPC returns one row per change.
  Even with confirmation thresholds (e.g. "next probe must agree"), the
  resulting list shows:
    - Two entries per incident (start + recovery)
    - Many 1-minute flaps from transient noise (probe-source GC pause,
      DNS cache miss, brief network latency)
    - Deploy phases that produce 3-5 small adjacent incidents which
      operationally are one event

  The user has to mentally filter noise to find real incidents; the
  fresh-log-line-per-minute cadence fatigues on-call.
solution: |
  Two SQL filters applied retroactively in the detection RPC,
  non-destructive (no events deleted):

  ```sql
  WITH ordered AS (
    SELECT target_id, observed_at, status,
      LAG(status)  OVER w AS prev_status,
      LEAD(status) OVER w AS next_status
    FROM probe_events
    WHERE observed_at >= now() - INTERVAL '90 days'
    WINDOW w AS (PARTITION BY target_id ORDER BY observed_at)
  ),
  confirmed_changes AS (
    -- Confirmation-filter baseline: next probe must agree (anti-flap)
    SELECT target_id, observed_at, prev_status AS from_status, status AS to_status
    FROM ordered
    WHERE prev_status IS NOT NULL
      AND prev_status <> status
      AND next_status = status
  ),
  incident_periods AS (
    -- ended_at via correlated MIN-subquery, NOT via LEAD on the
    -- WHERE-filtered set (would point to the next incident start,
    -- not the recovery — see lsn_postgres_window_function_after_where_filter).
    SELECT cc.target_id, cc.observed_at AS started_at, cc.to_status AS initial_status,
           (SELECT MIN(cc2.observed_at) FROM confirmed_changes cc2
            WHERE cc2.target_id = cc.target_id
              AND cc2.observed_at > cc.observed_at
              AND cc2.to_status = 'ok') AS ended_at
    FROM confirmed_changes cc
    WHERE cc.from_status = 'ok'
      AND cc.to_status IN ('degraded', 'down')
  ),
  -- FILTER 1: min duration (drop sub-threshold flaps)
  filtered AS (
    SELECT * FROM incident_periods
    WHERE ended_at IS NULL
       OR (ended_at - started_at) >= INTERVAL '120 seconds'
  ),
  -- FILTER 2: coalesce adjacent incidents (gap <= 600 s = 10 min)
  with_group AS (
    SELECT *,
      SUM(CASE
        WHEN LAG(ended_at) OVER w IS NULL THEN 1
        WHEN (started_at - LAG(ended_at) OVER w) > INTERVAL '600 seconds' THEN 1
        ELSE 0
      END) OVER w AS group_id
    FROM filtered
    WINDOW w AS (PARTITION BY target_id ORDER BY started_at ROWS UNBOUNDED PRECEDING)
  )
  SELECT target_id, MIN(started_at) AS started_at,
         CASE WHEN bool_or(ended_at IS NULL) THEN NULL ELSE MAX(ended_at) END AS ended_at,
         EXTRACT(EPOCH FROM (MAX(ended_at) - MIN(started_at)))::int AS duration_s
  FROM with_group
  GROUP BY target_id, group_id;
  ```

  Threshold rationale:
    - **Min duration ≈ 2× probe interval**: a probe interval of 60 s
      with a 1-probe confirmation already requires ≥ 60 s. 120 s
      requires ≥ 3 consecutive bad probes — structurally more than a
      source-side flap. 180 s would hide genuine 2-min incidents.
    - **Coalesce gap ≈ deploy-phase span**: typical deploy or restart
      phases span 2-8 min and produce short adjacent failures. 10 min
      is generous enough to merge them, short enough to keep
      hour-separated incidents distinct.
gotchas:
  - "These are display filters, not data filters — the raw probe-events table stays unchanged. Diagnostics (root-cause SQL) should still run on the raw `probe_events` table, not on the filtered RPC output."
  - "If a per-target latency threshold is added (e.g. higher tolerance for distant regions), keep the threshold in the probe-classification step (raw `degraded` vs `ok`), not in the duration filter — mixing them makes the SQL hard to reason about."
  - "When introducing these filters retroactively, capture row-counts before and after per target (`SELECT target, COUNT(*) ...`) and store the comparison in the ADR / vetted convention. Without that data, there is no proof the change reduced noise without losing real signal."
  - "JS-loader-side filtering looks simpler at first but breaks single-source-of-truth as soon as a second consumer appears (a JSON API, a dashboard widget, a Slack notifier). RPC-level filtering scales linearly with consumers."
last_validated_at: "2026-05-28"
---

## When this pattern applies

Any time-series event store with these properties:
- Events arrive at a fixed interval (cron probes, polling, periodic checks).
- Each event has a status enum (`ok` / `degraded` / `down`, or `healthy` / `unhealthy`, or `pass` / `fail`).
- A consumer (UI list, notification stream, dashboard) reads "changes" derived from the events.

Status pages, uptime monitoring, CI flakiness lists, model-eval drift tracking, alert systems — all fit the shape.

## When this does NOT apply

- Event-sourced systems where every event must be visible (audit logs, compliance, financial transactions). Filtering changes the history-of-record.
- Low-frequency events (one per hour or rarer) where each event is already individually meaningful. The filter would add nothing.
- Systems where short flaps ARE the signal (brown-out detection, micro-outage measurement, jitter analysis). Filtering removes the data of interest.
- High-stakes alerting where every degraded probe needs a human review — separate "raw alert stream" from "incident view" instead of filtering at the RPC.

## Verification

Capture the row-count before and after applying the filters:

```sql
-- Before:
SELECT target_id, COUNT(*) FROM old_get_incidents() GROUP BY target_id;
-- After:
SELECT target_id, COUNT(*) FROM new_get_incidents() GROUP BY target_id;
```

For each target, the after-count should be roughly 30-70% of the before-count if the noise profile matches typical probe-based monitoring. A >90% reduction means the threshold might be too aggressive (real incidents being hidden); <10% reduction means the noise was not dominant and these filters add little value — re-evaluate before locking in.

## Cross-references

- `lsn_postgres_window_function_after_where_filter` — the foot-gun this pattern depends on avoiding when computing `ended_at` in `incident_periods`.
- `lsn_postgres_function_overload_silent` — relevant when iterating on the detection RPC (DROP before CREATE on signature changes).
- `lsn_cache_static_lookups_in_postgres_not_edge` — same backend-first principle (compute in DB, not in Edge Function or client).

## Tool-use example for agents

Before building or refactoring a status-page incident-detection RPC:

```
search_lessons({
  query: "incident detection status page min duration coalescing",
  platforms: ["postgres"],
  tags: ["incident-detection"]
})
```

Then `get_lesson({id: "lsn_incident_list_min_duration_coalescing"})` for the full SQL template and threshold rationale.
