---
id: lsn_multi_currency_display_conversion_boundaries
title: "Multi-currency display: current values at spot, cost basis per-date FX, transaction values stay native"
type: workflow_best_practice
tier: community
summary: "In a multi-currency app, what to FX-convert is a four-way split, not a blanket rule: current aggregates → today's spot (EXACT, not an approximation); historical cost basis → per-date FX at the transaction date; native transaction values (unit price, fees) → leave in their own currency; domain-fixed values (legal-currency taxes) → never convert. Common failures: reflexively applying per-date FX everywhere (over-engineering), or converting native values by the reporting rate (a correctness bug)."
context:
  languages: [typescript, sql]
  platforms: [postgres]
  tags: [multi-currency, fx, reporting-currency, display-layer, finance]
---

## The problem

A user wants to view their portfolio in a chosen reporting/display currency (e.g. switch EUR ↔ USD). The naive instinct is "convert every money value by an exchange rate." That instinct produces two opposite failures:

1. **Over-engineering:** assuming all historical values need per-transaction-date FX, so you add server roundtrips / migrations to reconstruct historical rates everywhere — when most displayed values are *current* and a single spot rate is already exact.
2. **A correctness bug:** converting a value stored in a *native* currency (a USD stock's unit price) by the *reporting* currency's rate — producing a number that is neither the native price nor a correct conversion.

The fix is to classify each money value into one of four buckets before touching it. To retrieve this convention when starting such a feature: `search_lessons({ query: "multi-currency display reporting currency conversion", tags: ["multi-currency", "fx"] })`.

## The four buckets

| Value kind | Convert how | Why |
|---|---|---|
| **Current aggregate** (current value, today's gain/loss, net worth, current price) | today's **spot** rate | The value is "as of now" → today's rate is the *exact* answer, not an approximation. |
| **Historical cost basis** (what a past buy cost in reporting currency) | **per-date FX** at the transaction date | The native cost is fixed; its reporting-currency equivalent depends on the rate *at purchase time*. |
| **Native transaction value** (unit price, fees, order total in the trade's currency) | **leave native** — show its own symbol | A USD trade's price IS USD. Converting it by the reporting rate is wrong; show "$" not the reporting symbol. |
| **Domain-fixed value** (taxes in the jurisdiction's legal currency, regulatory amounts) | **do not convert** | The legal/reporting-of-record currency is part of the value's meaning. |

### Why "spot is exact for current values" matters

This is the non-obvious lever. A *current* portfolio value converted at *today's* rate is correct by definition — there is no "more accurate" historical rate to use, because the value itself is current. So the entire surface of present-value displays (the majority of a portfolio UI) needs only **one** spot rate, computed once and reused — no per-date FX, no server-side conversion, no schema changes. Per-date FX is required **only** for reconstructing a *historical* amount (cost basis, realized-P&L origin) whose reporting-currency value was fixed at a past date. Recognizing this scopes the "hard" work down from "the whole app" to "one or two historical aggregations."

### One display-formatter chokepoint

Route every reporting-currency render through a single shared formatter (a hook/util) that owns "currency + spot rate + format." This avoids whack-a-mole `€`/`$` hardcodings across dozens of files and makes the native-vs-reporting decision explicit at each call site: pass a reporting-currency aggregate to the shared `money()` formatter; for native values, format with the value's own currency symbol instead.

## Reconstructing historical cost basis

If the system stores the **native** price (not the reporting-currency amount paid), the reporting-currency cost basis is:

```
cost_basis_reporting = native_price / fx_rate_at_transaction_date
```

where `fx_rate` is "units of native currency per 1 unit of reporting currency" (invert if your table stores the other direction). Match whatever your authoritative server-side P&L code already does — do **not** invent a second FX convention. A typical server shape:

```sql
-- per-transaction reporting-currency basis, FX as-of the trade date
SELECT (t.qty * t.price + t.fees)
       / NULLIF(fx.rate, 0) AS basis_reporting
FROM transactions t
LEFT JOIN LATERAL (
  SELECT rate FROM fx_rates_history
  WHERE currency = t.currency AND date <= t.executed_at::date
  ORDER BY date DESC LIMIT 1            -- as-of lookup, not exact-date
) fx ON t.currency <> '<reporting>';
```

The `LATERAL ... date <= … ORDER BY date DESC LIMIT 1` is the as-of pattern: weekends/holidays have no row, so take the latest rate on-or-before the trade date (forward-fill). Client-side, the equivalent is a per-currency sorted array + binary search for the last date ≤ trade date.

## When this does NOT apply

- **Single-currency app.** No reporting-currency concept → skip entirely.
- **The reporting-currency amount is already stored** (broker persisted the paid amount). Then it is the ground truth — do **not** re-apply per-date FX; that would double-convert. Verify what the column actually holds before reconstructing.
- **Market/quote data** (index levels, instrument prices on a markets screen). These are market data, not portfolio holdings — converting an index to a personal reporting currency is misleading. Leave native/as-published.
- **Audit/tax-of-record views.** The legal currency is the point; a "display in USD" toggle there is wrong, not a feature gap.
- **You need bid/ask-accurate conversion.** Market mid-rate FX (what these tables hold) approximates a broker's actual executed rate (spread included, usually not stored). Fine for display, not for reconciliation.

## Verification

- Switch the reporting currency and walk every money surface: current aggregates change by ~the spot rate; native transaction lines keep their own symbol; tax/market views stay put.
- For a non-reporting-currency position with buys spread over time, the reconstructed historical cost basis should differ from a naive "native × today's rate" — and should match the server's P&L basis for the same lots.
- Confirm you did **not** add per-date FX to any *current*-value path (a spot rate there is correct and cheaper).
- Composing gotchas when FX lives in a Postgres/PostgREST table: `get_lesson({ id: "lsn_postgres_char_n_padding" })` (CHAR(3) `'USD '` padding — trim the read value), `lsn_supabase_numeric_string_coercion` (NUMERIC rate as JS string → `Number()`), `lsn_supabase_postgrest_row_limit_truncation` (multi-year history truncates at 1000 rows → paginate), `lsn_postgres_distinct_on_lateral_latest_per_group` (LATERAL beats DISTINCT ON for the as-of lookup).
