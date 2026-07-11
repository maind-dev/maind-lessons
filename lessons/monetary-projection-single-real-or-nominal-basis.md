---
id: lsn_monetary_projection_single_real_or_nominal_basis
title: "Fix biased money projections — never mix real and nominal values in one multi-period model"
tier: community
type: debugging_lesson
summary: "Multi-period money models (retirement, savings goals, cash runway, DCF) silently produce biased results when they combine real (today's purchasing power) and nominal (future face value) quantities in the same expression — e.g. growing capital at a nominal return but subtracting a today's-euro withdrawal, or comparing a nominal balance to a real target. Pick ONE basis for the whole model and convert to the other only at the display boundary."
context:
  languages: [typescript]
  platforms: []
  tags: [finance, financial-modeling, inflation, projection, correctness]
---

## Symptom

A retirement / savings / runway / forecast model gives results that are subtly wrong and hard to pin down:

- "Sustainable withdrawal" or "money lasts until age X" looks **too optimistic**.
- The headline balance doesn't agree with the gap/target shown right next to it.
- Two figures that should be comparable sit on different scales (one feels ~30% bigger than expected over a 30-year horizon — roughly an inflation factor).

## Cause

The model mixes **real** (constant purchasing power, "today's money") and **nominal** (face value at a future date) quantities in one computation. Because inflation makes 1 real unit ≠ 1 nominal unit at any future time, any expression that combines them is wrong. Common mixes:

- Growing capital at a **nominal** return but subtracting a **real** (today's-currency) withdrawal — the withdrawal is understated against the inflated balance → "lasts until" is too optimistic.
- Comparing a **nominal** projected balance to a **real** target/need (or showing a nominal headline next to a real gap).
- A 4%-style "sustainable income" computed on a **nominal** future balance but presented as today's spending power.

## Fix

Pick ONE canonical basis for the entire model and keep every quantity on it; convert only at the display edge.

- **Real (recommended for human-facing planners):** use a real return (`real ≈ nominal − inflation`), keep contributions / withdrawals / targets in today's currency. The result is in today's purchasing power. Show future face values only by converting at the boundary: `nominal = real × (1 + inflation)^years`.
- **Nominal:** keep the nominal return, but then EVERY cashflow must grow with inflation over time and targets must be inflated too.
- Never compare or combine a real and a nominal figure without an explicit conversion. If the UI has an "inflation-adjusted" toggle, make it switch **all** figures together, not just the chart.

## When this does NOT apply

- Single-period / present-value-only calculations with no time horizon — there is no inflation drift to mix.
- Models with inflation explicitly 0 (real == nominal; the distinction collapses).
- Deliberately showing both a real and a nominal column, clearly labelled — that's fine; the bug is mixing them *inside one number*.

## Verification

- With inflation = 0, the real and nominal paths are identical (property test).
- Real↔nominal round-trip is lossless: `toReal(toNominal(v)) ≈ v`.
- Every displayed figure shares the basis of the figures it is compared to; toggling real/nominal moves all of them consistently.