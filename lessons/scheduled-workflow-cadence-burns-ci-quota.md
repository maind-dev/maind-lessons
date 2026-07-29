---
id: lsn_scheduled_workflow_cadence_burns_ci_quota
title: "Audit scheduled-workflow cadence before it burns the CI quota and silently stops a publishing job"
type: workflow_best_practice
tier: community
summary: "On metered CI (private repos on the free tier), a frequent `schedule:` is usually the thing that exhausts the monthly minutes — frequency times run-duration is an arithmetic nobody performs when adding the cron. The expensive part is not the red PR checks: if one of the dead scheduled jobs *publishes* something (a content bundle, an index, a mirror), production quietly stops receiving updates with no failing check anyone is looking at."
context:
  platforms:
    - github-actions
  tags:
    - ci
    - scheduled-jobs
    - quota
    - silent-failure
    - cost
---

## The arithmetic nobody does

A `schedule:` gets added with a comment like "safety net, cheap". Nobody
multiplies:

```
runs per month  ×  duration per run  =  minutes per month

*/15 * * * *  →  ~2880 runs  ×  1.4 min  ≈  4000 min/month
0   * * * *  →   ~720 runs  ×  1.4 min  ≈   970 min/month
23  4 * * *  →     ~30 runs  ×  1.4 min  ≈    41 min/month
```

A free-tier private repository includes on the order of 2000 Actions
minutes/month. The first line alone is double that — from one workflow whose
individual runs feel trivially short. Public repositories are unmetered, which
is exactly why the habit survives: the same cron was free in the last project.

When the allowance is gone, **every** workflow in the repo fails at
assignment — the PR checks are collateral, not the cause.

## The part that actually hurts

Red PR checks are loud: someone opens a PR, sees red, investigates. A dead
*scheduled* job is silent by construction — no PR, no reviewer, no red X in
anyone's field of view.

So the ranking of damage is inverted from the ranking of visibility:

| Job | Failure visible? | Consequence |
|---|---|---|
| PR check (test, lint, typecheck) | Yes, immediately | Annoyance; local runs substitute |
| Scheduled **publish** (bundle, index, mirror, cache warm) | **No** | Consumers keep serving the last successful artifact — indefinitely, with no symptom |

The second row is the one to design against. A publishing job that stops
publishing produces no error anywhere: downstream consumers keep loading the
previous artifact and behave normally, just with stale data. The gap is only
discovered when someone asks "why is this change not live?" — often weeks
later.

## Detect it

```bash
# 1. Which workflows are scheduled, and how often?
grep -rA2 "schedule:" .github/workflows/ | grep cron

# 2. What did a SUCCESSFUL run of the expensive one actually cost?
gh run list --workflow <file>.yml --limit 100 \
  --json conclusion,createdAt,updatedAt \
  --jq '[.[] | select(.conclusion=="success")] | .[0]
        | "\(.createdAt) -> \(.updatedAt)"'

# 3. Did it EVER succeed, and when did that stop?
gh run list --workflow <file>.yml --limit 400 --json conclusion,createdAt \
  --jq '[.[] | select(.conclusion=="success")] | max_by(.createdAt).createdAt'
```

A last-success date weeks in the past, followed by an unbroken run of
failures, is the signature. Multiply (1) by (2) to see whether this workflow
is the burner.

## Fix it — cadence, events, escape hatch

1. **Match the cadence to how fast the input actually changes.** Content that
   changes a few times a week does not need a 15-minute poll. Daily is usually
   right; the honest question is "what is the worst acceptable latency between
   a merge and it being live?", not "how fresh can we make it".
2. **Prefer event-driven over polling.** `repository_dispatch` (or a
   `workflow_run` chain) costs one run per actual change instead of 96 per day
   on the chance that something changed. Check that it is genuinely wired —
   a comment claiming "instant via dispatch" in the consuming workflow is not
   evidence that any producing repo fires it.
3. **Keep `workflow_dispatch` as the escape hatch.** With a manual "publish
   now" button, a long schedule stops being a latency problem: the rare urgent
   case costs exactly one run.
4. **Pick an off-peak, non-round minute** (`23 4 * * *`, not `0 0 * * *`) —
   scheduled jobs across the platform pile up on the hour and get delayed.
5. **Alert on staleness, not on failure.** The durable fix for the silent-publish
   class is a consumer-side check ("artifact older than N days") — that fires
   whether the job failed, was never triggered, or the quota is gone.

## When this does NOT apply

- **Public repositories** and self-hosted runners: Actions minutes are not
  metered the same way, so cadence is a cost question rather than an outage
  risk. The silent-publish argument still stands on its own.
- **Genuinely latency-critical schedules** (health probes, incident detection,
  alerting cron). There the frequency *is* the product — budget for it
  explicitly and move heavy work off the polling job.
- **Diagnosing an already-red repo:** this vetted convention covers cause and
  prevention. For classifying a run that failed in ~2 s with no logs, see the
  cross-reference below first.

## Cross-references and retrieval

```
search_lessons({
  query: "scheduled workflow cron cadence CI minutes quota silent publish",
  platforms: ["github-actions"],
  tags: ["quota"]
})
```

- [[lsn_github_actions_billing_exhausted_zero_step_fail]] — the **diagnosis**
  side of the same outage: how to recognise a billing-exhausted run (~2 s,
  zero steps, 404 logs) and what to do while it lasts. This entry is the
  cause-and-prevention half; read that one when the checks are already red.
