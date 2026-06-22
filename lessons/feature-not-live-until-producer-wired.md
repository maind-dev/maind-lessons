---
id: lsn_feature_not_live_until_producer_wired
title: "A data-consuming feature ships dark until its producer is wired into the default scaffold users copy"
type: workflow_best_practice
tier: community
summary: "When a feature's value depends on inbound data — telemetry, feedback, analytics, attribution — building the consumer (dashboard, aggregate, alert) is only half the work. Until the data-EMITTING step is wired into the default template / scaffold / onboarding users actually copy, the downstream stack stays data-starved. The gap passes review because the consumer compiles and renders an empty state. Wire the producer into the default path, or the feature ships dark."
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: []
  tags: [product-engineering, telemetry, scaffolding, feature-completeness, data-pipeline]
last_validated_at: "2026-06-22"
---

## The failure mode

You build a feature whose value depends on data flowing IN: a usage dashboard, a feedback queue, a CI-signal aggregate, an attribution report, an A/B metrics view. You build the **consumer** end carefully — the table, the RPC, the chart, the alert. It compiles, it renders an honest empty state, code review approves it, it merges. It looks done.

Months later the dashboard is still empty. Nobody wired the **producer** — the step that actually emits the data — into the path users follow by default. The consumer was never the hard part; the missing half is the emit-step in the place users copy.

Concrete shape (anonymized from a real build): a team shipped a full ingestion → feedback → metrics → analytics stack behind a CLI. The dashboard that generated the starter CI workflow for customers emitted only the *context-pull* step. Every downstream phase — the failure-report, the outcome-report, the metrics, the team view — was built and merged, but the generated workflow customers copied never emitted a single signal. The whole stack was "live" in code and dead in production until the emit-steps were added to the generated template.

## Why it survives code review

- The consumer **compiles and renders** — an empty table or "no data yet" state looks intentional, not broken.
- Reviewers check the diff in front of them (the consumer), not the absence of a wiring change in a **different** file (the default template/scaffold/onboarding).
- Tests pass: unit tests mock the data; there's rarely a test asserting "the default scaffold emits the producer step."
- The producer often lives in a generated artifact, an onboarding doc, or an SDK init snippet — outside the feature's own folder, so it's easy to forget.

## The check

Before calling a data-dependent feature done, answer: **"In the default path a new user follows, what emits the data this feature consumes — and is that step present without the user having to know to add it?"**

If the emit-step is opt-in, buried in docs, or absent from the generated scaffold, the feature is not live — it's a consumer waiting for a producer that will never be wired by most users.

Wire the producer into the **default**:
- Telemetry/analytics → the SDK/init snippet in the quickstart, not a docs footnote.
- CI signals → the **generated** workflow/template, not "you can also add this step."
- Feedback → the default UI surface, not a settings toggle off by default.
- Attribution → the default instrumentation, emitted before the consumer is announced.

A useful sequencing rule: **ship the producer first (or together), announce the consumer second.** A consumer announced ahead of its data source trains users that the feature is empty/broken.

## When this does NOT apply

- **The producer already exists by default.** If the data your feature consumes is already emitted on the default path (you're adding a new *view* over data that already flows), there's nothing new to wire.
- **Deliberately manual producers.** Some signals are intentionally opt-in for privacy/consent reasons (e.g. telemetry that legally must be off by default). There the empty state is correct — but say so explicitly, and don't measure the feature's success on data that consent gates away.
- **Internal-only tools with a known operator.** If the single operator both builds the consumer and runs the producer by hand, default-wiring matters less. This bites hardest for features shipped to *other* people who copy a scaffold.

## Related

This is the "looks done in the build, dead at runtime" class — verify the end-to-end path a user actually follows, not just that the consumer compiles ([[lsn_subagent_edit_not_write]]). An empty dashboard is a silent failure that reads as a valid state ([[lsn_surface_silent_errors_first]]).

## Surface this

```js
search_lessons({ query: "feature data source wired default scaffold producer consumer empty", limit: 5 })
```
