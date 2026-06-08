---
id: lsn_forward_fill_sparse_event_series
title: "Fix a sparse-series forward-fill that silently drops off-grid events (use a merge-walk)"
type: debugging_lesson
tier: community
summary: "Forward-filling values emitted only at irregular event dates (transactions, state changes) onto a denser output grid must NOT reuse the forward-fill written for a dense series (quotes/FX). The dense pattern samples sparse.get(outputDate) and only catches events landing exactly on a grid date — off-grid events are silently dropped, carrying a stale earlier value. Fix: a sorted merge-walk consuming all events with date <= each output date. Failure mode is silent undervaluation, no error."
context:
  languages: [typescript]
  platforms: []
  tags: [time-series, forward-fill, sparse-series, data-processing, silent-bug]
---

A *forward-fill* (carry the last known value forward over gaps) is trivial when the source series is **dense** — e.g. daily market quotes or FX rates that already have a row for (almost) every day in the output grid. The usual implementation samples the grid:

```ts
// Works ONLY because quotes/FX are, by construction, on the output grid (allDates)
const sparse = new Map(rows.map(r => [r.date, r.value]));
let last = null;
for (const date of allDates) {
  const v = sparse.get(date);   // hit only when an event lands exactly on a grid date
  if (v != null) last = v;
  if (last != null) out.set(date, last);
}
```

This silently breaks the moment you reuse it for a **sparse event series** — values emitted only at irregular event dates (transactions, status changes, config edits). Those event dates are not guaranteed to coincide with the output grid (trading days, calendar days, sampling timestamps). Every event whose date is not exactly an `allDates` entry is **never sampled** → `last` keeps an older value → the filled series is stale/undervalued. There is **no error** — just wrong numbers.

## Why the dense version looked correct

The dense series *is* the grid: `allDates` is typically built as the union of the quote dates, so `sparse.get(date)` always hits. Copy that code to a sparse series and the same line silently drops most events.

## The fix: a sorted merge-walk

For each output date, consume **all** events with `date <= outputDate` (regardless of whether the event date is on the grid) and carry the latest:

```ts
// points: events sorted asc by date; allDates: output grid sorted asc
const out = new Map();
let i = 0, last = null;
for (const date of allDates) {
  while (i < points.length && points[i].date <= date) {
    last = points[i].value;   // consumes off-grid events too
    i++;
  }
  if (last != null) out.set(date, last);
}
```

O(events + grid). This also subsumes any "warm-up" (events before `allDates[0]` are consumed when processing the first grid date), so a separate pre-window scan is unnecessary.

## Detection

- Symptom: a carried-forward line (cost basis, balance, running total) sits **below/behind** the independently-computed current value, with no error.
- Cross-check: compute the same aggregate a second way (e.g. the raw "current state" total) — if the forward-filled series diverges from it at the latest point by more than rounding, suspect dropped events.
- Code smell: a forward-fill that does `sparse.get(date)` over the output grid being fed a series whose event dates are *not* the grid.

## Guard rails

- Both arrays must be sorted ascending; the walk relies on it.
- A `value === 0` event is a real event (e.g. a zero-cost transfer) — carry it; don't treat 0 as "missing" the way you might treat a 0 price.
- This is orthogonal to *gating*: forward-fill carries the last value indefinitely; a separate "is this entity still active on this date?" gate (e.g. quantity > 0) decides whether the carried value is used — the source may legitimately stop emitting (e.g. a fully-closed position) without emitting a terminating zero.

## When this does NOT apply

- The source series is already dense on the output grid (a row per grid day, like daily quotes/FX) — `sparse.get(date)` is fine and the merge-walk is unnecessary.
- You built the output grid as the union of the event dates, so every event lands on the grid by construction — either approach works.
- You want point-in-time values only on grid dates with no carry-forward — that is not a forward-fill at all.

## See also

Sibling silent-data-loss in the same chart/cost-basis domain: `lsn_supabase_postgrest_row_limit_truncation` (PostgREST caps a read at 1000 rows with no error, freezing a cost-basis line at an old date). When a carried-forward line looks wrong, rule out both causes — dropped off-grid events (this convention) and a truncated source read.

```
search_lessons({ query: "forward-fill sparse series stale carried value", tags: ["time-series"] })
```
