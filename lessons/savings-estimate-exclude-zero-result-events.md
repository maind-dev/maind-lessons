---
id: lsn_savings_estimate_exclude_zero_result_events
title: "Fix inflated count-x-factor savings estimates: exclude zero-result events"
type: debugging_lesson
tier: community
summary: "Savings estimates of the form event_count x calibrated_factor silently price in events that have no counterfactual benefit — a zero-result search replaces no file read, an empty cache hit saves nothing. Zero-result is often the TYPICAL state for new users (setup chain not completed), so the inflation hits exactly the cohort seeing the number for the first time. Filter to events with a real counterfactual (result_count > 0) in the estimate only; activity counters should keep counting all events."
context:
  tools: []
  languages: ["sql"]
  platforms: ["postgres", "supabase"]
  tags: ["analytics", "estimation", "honesty", "metering", "dashboard"]
---

## The failure mode

A common dashboard pattern estimates a benefit that cannot (yet) be measured directly:

```
estimated_savings = number_of_events x calibrated_per_event_factor
```

The factor comes from a benchmark ("a typical search saves ~9,200 tokens vs. reading whole files"). The subtle bug: the count includes **events with no counterfactual benefit**. A search that returns 0 results replaces no whole-file read — the user's agent falls back to reading files anyway. Pricing that event at the full factor inflates the estimate.

Why this bites harder than it looks: zero-result is frequently the **typical state for new users** — e.g. a cloud search over an index the user has not built/synced yet returns nothing until a multi-step setup chain is completed. So the inflation is not uniform noise; it is concentrated on exactly the cohort that sees the number for the first time and decides whether to trust the product's claims.

## The fix pattern

Filter the estimate's count to events with a real counterfactual, e.g. in a Postgres rollup RPC:

```sql
SELECT count(*)
  INTO v_est_count
  FROM public.tool_events
 WHERE tool_name  = 'cloud_search'
   AND event_type = 'tool_result'
   AND COALESCE(result_count, 0) > 0   -- zero-result events have no counterfactual
   AND created_at >= v_since;
```

Two design rules around it:

- **Activity counters stay unfiltered.** A zero-result search IS a search — usage/adoption metrics should count it. Only the *savings/benefit* estimate must not price it. Keep the two queries separate and document why they differ.
- **Guard the filter against silent regression.** If your migrations can redefine the RPC (CREATE OR REPLACE from a stale baseline), anchor the exact filter expression (e.g. `COALESCE(result_count, 0) > 0`) as a required substring in a drift-check manifest — see [[lsn_postgres_function_body_drift_dropcreate]]. Prefer the exact expression over a bare column name: the column name may legitimately appear elsewhere in the body, making the guard toothless.

## Calibration gotcha: benchmark at the parameters users actually hit

The per-event factor itself is only as honest as its calibration. Concrete trap from the field: the benchmark producing the factor ran the search at `limit=5`, while the production server default was `limit=10` — so the "result tokens" subtrahend baked into the factor was roughly half of what real calls produce. When you calibrate a count-x-factor estimate:

- run the benchmark with the **server-side defaults** (limit, scope, options) that uninstrumented production calls actually use;
- re-pull ALL benchmark components together when re-calibrating (baseline and subtrahend move together with the parameters);
- remember that published marketing numbers derived from the same benchmark must move consistently — a re-benchmark is an outward-facing change, not a quiet constant bump.

## Verification

Seed one event with results and one with zero results, then assert the estimate counts only the former:

```sql
-- seed: 2 events with result_count > 0, 1 with result_count = 0
SELECT (public.get_savings_rollup(30))->>'estimated_event_count';  -- expect 2, not 3
```

Run it as a rollback-transaction test against a local stack so CI/dev data stays clean.

## When this does NOT apply

- **Activity/adoption metrics** — count everything, including zero-result events (see above).
- **Benefits that exist independent of result count** — e.g. a dedup check that saves work precisely when it finds nothing has its counterfactual inverted; the filter would be wrong there. The test is "does THIS event replace the expensive alternative?", not "did it return rows?".
- **Measured (not estimated) savings** — if the client measures actual before/after sizes per event, zero-result events self-price at ~0 and need no filter.

## Tool-use example for agents

When reviewing or designing a savings/benefit rollup:

```
search_lessons({
  query: "savings estimate zero result count factor inflation",
  platforms: ["postgres"],
  tags: ["estimation"]
})
```

Then `get_lesson({id: "lsn_savings_estimate_exclude_zero_result_events"})` before locking in the estimate query.
