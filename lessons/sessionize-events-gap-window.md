---
id: lsn_sessionize_events_gap_window
title: "Reconstruct sessions from an event log without a session_id using a time-gap window function"
type: workflow_best_practice
tier: community
lesson_class: architecture
quality_tier: experimental
context:
  tools: []
  languages: [sql]
  platforms: [postgres]
  tags: [postgres, window-functions, sessionization, analytics, event-stream]
summary: "To group an append-only event log into sessions with no session_id: flag each row whose gap to the previous exceeds a threshold (`created_at - LAG(created_at) OVER w > interval '30 min'`), then a running `SUM` of those flags over the same window is the session number. Crucially PARTITION the window BY the actor (user/client) — else concurrent actors interleave in time and merge into one false session. Bound output (top-N sessions, cap rows/session) against the JSONB/statement-timeout cliff."
problem: "An events table had no session_id, but the UI needed per-session tool-call traces and cross-session transition graphs."
solution: "Two CTEs: (1) flag new-session boundaries via LAG over a per-actor time-ordered window, (2) a running SUM of the flag = session index; then aggregate per (actor, session_index)."
gotchas:
  - "Forgetting to PARTITION BY the actor — concurrent actors interleave in time and collapse into one bogus session."
  - "Relying on explicit session-start/-end markers alone — not every client emits them; the time-gap heuristic is client-agnostic."
  - "Unbounded output — a wide window over all sessions can exceed the JSONB-width / statement-timeout limit; cap sessions and rows-per-session."
evidence: "Used to build per-session traces from an MCP telemetry table (`mcp_events`) that has no session_id; partitioning by client family was required to stop parallel agent sessions merging."
last_validated_at: "2026-06-10"
---

## The problem

An append-only event log (analytics events, tool calls, page views) has no `session_id`, but you need per-session views or session-scoped aggregates.

## The pattern

Two window-function passes over the events, ordered by time **per actor**:

```sql
WITH flagged AS (
  SELECT *,
    CASE
      WHEN LAG(created_at) OVER w IS NULL
        OR created_at - LAG(created_at) OVER w > interval '30 min'
      THEN 1 ELSE 0
    END AS is_new_session
  FROM events
  WINDOW w AS (PARTITION BY actor_id ORDER BY created_at)
),
numbered AS (
  SELECT *,
    SUM(is_new_session) OVER (PARTITION BY actor_id ORDER BY created_at) AS session_index
  FROM flagged
)
SELECT actor_id, session_index, min(created_at) AS started_at, count(*) AS n
FROM numbered
GROUP BY actor_id, session_index;
```

A gap larger than the threshold starts a new session; the running `SUM` of those boundary-flags is a stable per-actor session number.

## PARTITION BY the actor — the part people miss

Without `PARTITION BY actor_id`, two actors active in the same minutes interleave in global timestamp order, and the gap heuristic stitches them into one bogus session. Partition by the actor (user / client / device) so each stream is independent. The same partition must appear in BOTH the `LAG` and the running `SUM`.

## Bound the output

A naive query over a long window × all sessions × all rows can be huge — and if you assemble JSONB, it can hit the row-width / statement-timeout cliff (see `lsn_postgres_jsonb_rpc_timeout`). Cap it: top-N most-recent sessions, and a max rows-per-session.

## Tuning notes

- The gap threshold is a documented, tunable constant — 30 min suits interactive agent/user sessions; shorten for high-frequency streams.
- Use explicit session-start events as an *additional* boundary signal if some clients emit them, but don't rely on them alone.

## When this does not apply

- If your events already carry a real `session_id` (most web-analytics SDKs do), use it — this is only for logs without one.
- If exact session semantics matter for billing/security, prefer an explicit, server-issued session token over a time-gap heuristic.

```ts
search_lessons({ query: "sessionize events without session_id window function", platforms: ["postgres"] })
```
