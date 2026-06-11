---
id: lsn_delegating_function_drops_filter_param
title: "Fix a filter/toggle that has no effect — a delegating wrapper accepts the param but never forwards it"
tier: community
type: debugging_lesson
summary: "A UI filter, flag, or toggle visibly does nothing even though the value reaches the API/RPC. Common cause: a wrapper/delegating function accepts the parameter at its boundary but does not thread it to the inner function/CTE that computes the displayed values — so it silently no-ops, while secondary outputs that DO use it react. Trace the parameter end-to-end from UI to every computation layer; the gap is usually one un-forwarded argument."
context:
  languages: [typescript, sql]
  platforms: []
  tags: [debugging, api-design, delegation, data-flow, silent-failure]
---

## Symptom

A filter / toggle / time-window / "show X" control in the UI **changes nothing** in the output, even though the control updates state/URL correctly, the value is passed into the API call / RPC, and *other* parts of the response (a side panel, a secondary chart) DO react to it.

## Cause

The parameter is accepted at the **outer** boundary but **dropped before the layer that computes the values you're looking at**. Classic shapes:

- A wrapper `outer(p_filter)` delegates to `inner(...)` and forwards only a **subset** of its arguments — `inner` computes the headline numbers globally, unaware of `p_filter`. (e.g. a SQL wrapper that builds per-filter *overlay* series but calls a base function without the filter, so the base KPIs stay unfiltered.)
- The param is read but applied to only **one** of several code paths (the chart is filtered; the summary card is not).
- A default masks the gap: `inner(p_filter ?? 'all')` is called without the real value, so it always takes the "all" branch.

The give-away: **some** outputs react, others don't — proving the value reaches the boundary but not every consumer.

## Fix

Trace the parameter end-to-end and make every computation layer that feeds an affected output receive it:

- Thread the argument through the delegate call (`inner(..., p_filter)`), not just the overlay/secondary path.
- If the inner function is shared and you change its arity, mind the Postgres overload trap — changing a function's signature creates a silent overload, not a replacement ([[lsn_postgres_function_overload_silent]]).
- Add a regression guard: assert the filtered and unfiltered calls return *different* results, and that the "all"/default value reproduces the previous (unfiltered) behavior.

## Localize it fast

1. Diff the request payload for two filter values — confirm the param differs on the wire.
2. If it does, the bug is compute-side: grep the handler for the param name and check it appears in **every** query/CTE/branch that produces a visibly-affected value, not just one.
3. The place where the param is missing downstream is the dropped link.

## When this does NOT apply

- If the param legitimately shouldn't affect that output (e.g. an IDE-client filter that genuinely doesn't apply to website-visit metrics), "no change" is correct — document it instead of forcing a filter.
- If the wire payload doesn't even carry the changed value, the bug is upstream (state/serialization), not a dropped forward.

## Verification

Call the compute layer directly with two distinct param values → the affected outputs differ; the default/"all" value reproduces the pre-feature result.