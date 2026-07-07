---
id: lsn_healthcheck_probe_self_referential_feedback_loop
title: "Health-check probes must not read the table they populate — self-referential feedback loop"
type: workflow_best_practice
tier: community
summary: "A health/status probe that measures DB reachability by querying the very table the probe writes to creates a self-referential feedback loop: each run grows the table, every future run's query gets heavier, latency creeps up until it crosses the 'degraded' threshold — with no change in actual health. Probe with a constant-cost liveness check (SELECT 1), not an aggregate over the monitoring data. Related: availability metrics must treat 'degraded' as reachable, not as an outage."
context:
  tools: []
  languages: [sql, typescript]
  platforms: [postgres, supabase]
  tags: [monitoring, status-page, health-check, feedback-loop, observability, availability]
---

## The anti-pattern

A status page probes "is the database reachable?" every N minutes and stores each result in a table (e.g. `service_checks`). Tempting implementation: have the DB-check call the same RPC the status page uses to read current state — an aggregate like `SELECT DISTINCT ON (service) ... FROM service_checks`.

Now the probe **reads the table it writes to**. Every run appends rows; every future run's read gets a little heavier. Over weeks the measured "DB latency" climbs purely from the growing self-scan, with no change in actual database health.

## The tell-tale signature

Symptoms that point at this class rather than a real outage:

- The probed component is **never `down`, always `degraded`** (it responds — just slower than the threshold).
- The latency **rises monotonically over days/weeks**, tracking the retention window, not load spikes.
- **Only the self-referential probe degrades**; sibling checks hitting unrelated endpoints stay flat. (Diagnostic: pivot avg-latency per probe over weeks — if exactly one climbs and it's the one reading the monitoring store, you've found it.)

## The fix: constant-cost liveness

Probe reachability with something whose cost is independent of the monitoring data:

```sql
-- trivial, table-independent ping
CREATE FUNCTION health_ping() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
```

The probe calls `health_ping()` (or `SELECT 1`), not the status aggregate. Reachability is now measured, not the size of the history table. Keep the heavy aggregate for the human-facing page, where it runs on demand — and optimize *that* separately (see `lsn_postgres_distinct_on_lateral_latest_per_group`).

Bonus consistency: make the DB-check use the same lightweight transport as your other checks (a plain `fetch` to the REST endpoint) rather than instantiating a fresh heavy client inside the timed section — otherwise you are timing client construction, not the database.

## Related anti-pattern: degraded is not an outage

The same incident usually exposes a second flaw: the uptime number counts `degraded` as not-OK. Then a component that is *always reachable but sometimes slow* reads as ~50 % "uptime" — which looks like a half-outage to users. Separate the two questions the metric conflates:

- **Availability** = `(total − down) / total` — was it reachable? (`degraded` counts as reachable.)
- **Performance** = `operational / total` — was it within the latency budget?

Show both. `degraded` stays a visible performance signal, but no longer masquerades as downtime. A persistent "~50 %" that never maps to a real outage is the smell that an availability formula is folding performance into uptime.

## When this does not apply

If the monitoring table is aggressively capped (a rolling small window) or the probe reads an O(1) indexed "latest" row rather than a full aggregate, the loop is bounded. Likewise, if your probe deliberately exercises a representative real query as a synthetic-transaction SLO, that is intentional — just keep its cost bounded and independent of unbounded history. The hard rule is narrower: never let a probe's cost grow with the history it is itself producing.

## For agents

```text
search_lessons({ query: "health check probe degraded latency grows monitoring", platforms: ["postgres"] })
get_lesson({ id: "lsn_healthcheck_probe_self_referential_feedback_loop" })
```
