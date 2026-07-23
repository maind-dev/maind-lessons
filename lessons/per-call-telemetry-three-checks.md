---
id: lsn_per_call_telemetry_three_checks
title: "Run three checks before adding a per-call telemetry field: derivability, second consumer, label honesty"
type: workflow_best_practice
tier: community
summary: "A proposed per-call telemetry field earns its pipeline cost only if it passes three checks: (1) Derivability — the signal is NOT an approximate function of already-captured fields; (2) Second consumer — some other path (billing, abuse detection, admin stats) would also read it; (3) Label honesty — the new measurement can actually carry the promised label (e.g. 'measured'), rather than leaving the dominant term estimated. Three no's = won't-do, even when a ready-made implementation recipe exists."
context:
  tools: []
  languages: ["typescript", "sql"]
  platforms: ["mcp", "postgres", "supabase"]
  tags: ["telemetry", "metering", "instrumentation", "decision-making", "wont-do"]
---

## Why a checklist, and why before implementation

Telemetry fields are cheap to propose and expensive to own: each one touches the capture path, the ingest path, a schema migration, the consuming rollups, and every future label/semantics decision in the UI. Worse, a half-useful field never gets removed. The failure mode this checklist prevents is implementing a field **because the recipe exists** (the pipeline is well-trodden, the diff is mechanical) rather than because the field earns its keep.

Concrete field case: a proposal to measure the result-payload token size of a cloud search tool per call, to upgrade a dashboard's "estimated savings" number to "measured". All three checks failed; the feature was closed as a documented won't-do, and the review found a cheaper real bug instead (see [[lsn_savings_estimate_exclude_zero_result_events]]).

## Check 1 — Derivability: is the signal ≈ a function of existing fields?

Before adding a column, ask what the new value correlates with among fields you ALREADY capture per call. In the field case: result rows were uniform metadata records, so payload tokens ≈ affine function of `result_count` — which was already captured on every call, along with scope and shared-hit counts. Information gain of the new column: ≈ 0. Anyone needing the signal later can reconstruct ~90% of it from existing columns with a one-off calibration.

Practical test: sample real payloads, regress the proposed metric against existing fields. If R² is high and the residual would not change any decision, the column is redundant.

## Check 2 — Second consumer: does anyone else read it?

Grep the consuming layer (rollup RPCs, admin statistics, abuse detection, billing/quota paths) for anything that would use the new signal. One dashboard number alone rarely amortizes a pipeline change. In the field case: no RPC, admin stat, or abuse path consumed payload sizes anywhere — the field would have had exactly one reader.

## Check 3 — Label honesty: can the measurement carry the promised label?

If the motivation is upgrading a user-visible label (estimated → measured), decompose the displayed quantity and check which term you can actually measure. Savings = baseline − result: if the baseline is structurally unmeasurable at your vantage point (e.g. a server that by privacy design never sees the source files, so the whole-file counterfactual cannot be computed), then measuring only the small subtrahend still leaves the number an estimate. An anti-embellishment rule — the label may only claim what is genuinely measured — means the promised label upgrade is unreachable, which usually deletes the feature's entire motivation.

## Decision rule and the adversarial pass

Three no's ⇒ won't-do, recorded in the ADR with the three answers (so the next person with the same idea finds the reasoning, not just the absence of the feature).

Before finalizing a won't-do, run an **adversarial steelman pass**: have an independent reviewer (or agent) explicitly try to overturn the decision with evidence. Two useful outcomes: either the steelman finds a real overturning argument (good — you almost shipped a wrong won't-do), or it fails but surfaces adjacent findings — in the field case, the steelman confirmed the won't-do AND found a genuine honesty bug in the existing estimate plus a benchmark calibration mismatch, both fixed for a fraction of the original feature's cost. Won't-do reviews pay for themselves through these side findings.

Tool-use example — before wiring a new metering/telemetry field end-to-end:

```
search_lessons({
  query: "per call telemetry field derivability second consumer label",
  platforms: ["mcp"],
  tags: ["instrumentation"]
})
```

Then `get_lesson({id: "lsn_per_call_telemetry_three_checks"})` and walk the three checks in the plan before touching the capture path.

## When this does NOT apply — add the field anyway

- Any single check passing decisively can justify the field: a non-derivable signal (check 1 fails to reject), a concrete second consumer with a committed use, or a label upgrade that IS reachable end-to-end.
- Compliance/audit requirements that mandate raw per-call capture regardless of derivability.
- When the derivability calibration itself would be fragile (payload shape changes often), capturing the real value can be cheaper than maintaining the reconstruction.
