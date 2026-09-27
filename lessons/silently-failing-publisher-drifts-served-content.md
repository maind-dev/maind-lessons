---
id: lsn_silently_failing_publisher_drifts_served_content
title: "Diagnose live content that stays stale after a green redeploy — the serving source, not the image, is the truth"
type: debugging_lesson
tier: community
summary: "Content is often served at runtime from a separately-published source refreshed by a scheduled job — not the deploy image (a cold-start floor the serving source overrides). If that publisher silently stops (often: CI blocked by billing/quota), live content freezes with no error and redeploying never fixes it. Diagnose the serving source's freshness (version/age on /health), not the build. Heuristic: whole-repo CI red-out means billing, not code."
context:
  tools: [claude-code, docker, flyctl, github-actions]
  languages: []
  platforms: [fly.io, supabase, node]
  tags: [deployment, ci, caching, stale-content, serving-plane, billing, observability]
last_validated_at: "2026-07-24"
---

## The trap

Your source of truth is correct. The deploy is green. You redeploy — twice, three
times, you even restart the machine — and the live service keeps serving the OLD
content, with no error anywhere.

The hidden assumption: that the deployed image *is* what the service serves. In
many mature systems it is not. Content/artifacts are served at runtime from a
**separately published source** — a bundle in object storage, a CDN path, a model
or rules registry, a DB — that a **scheduled job** republishes. The deploy image
is only a cold-start *floor*. When a live copy exists in the serving source, it
**overrides** the image. So rebuilding and redeploying the image cannot change what
users get: you are editing the floor while the serving source stays stale.

## Why it goes stale silently

The publisher is an independent component, and its failure is invisible from the
consumer side:

- The **scheduled job that republishes** (a CI workflow, a cron) stopped. The most
  under-diagnosed cause: **CI is blocked by billing** — a failed payment or an
  exhausted monthly spending-limit/quota disables the whole account's runners, so
  the job "was not started" and produced no logs. Nothing in the app repo changed;
  nothing turned red in a way you were looking at.
- A **cache in front of the pointer** (e.g. object storage defaults to a ~1h CDN
  cache on the manifest) serves a stale "which version is current" pointer, so even
  a fresh publish stays invisible for the cache TTL.

Both look identical from the app: correct source, correct image, green deploy,
stale behavior.

## Diagnose the serving source, not the build

1. **Ask the running service what it is actually serving**, not what you deployed.
   Expose it on the health endpoint and check it first:

   ```json
   { "content_version": "…", "content_built_at": "…", "content_age_seconds": 123456 }
   ```

   A `null` version means it fell back to the baked floor (the serving source is not
   loading). A large/growing age means the publisher stopped. `content_age_seconds`
   turns a silent drift into a visible number.

2. **Look at the publisher's last SUCCESS, not its last run.** "Green 2 weeks ago,
   red every run since" is the signature.

3. **Whole-repo red-out means suspect billing/quota, not code.** If *every* check on
   *every* branch (including the default branch) fails within seconds with no step
   logs, that is not your diff — it is the account. GitHub Actions surfaces it as
   "recent account payments have failed or your spending limit needs to be
   increased." Check Billing before you debug code. (The same outage can also make
   the PR/API flaky — same root, many symptoms.)

## Verification

```bash
# 1. What is the LIVE service actually serving? (not what you deployed)
curl -s https://your-service.example.com/health | jq '{content_version, content_age_seconds}'
# null version  -> serving source not loading, running on the baked floor
# huge/growing age -> the publisher stopped; republish, do NOT redeploy

# 2. Publisher's last SUCCESS, not last run:
gh run list --workflow <publisher>.yml --limit 40 --json conclusion,createdAt \
  | jq '[.[]|select(.conclusion=="success")][0] // "no success in window"'
# many-in-a-row failures ending in ~2s with no logs -> account/billing, not code
```

## The fix (two layers)

- **Republish the serving source** — that is the actual remedy, not a redeploy.
  Have a **billing-independent** way to publish (a local script that does what the
  CI job does) so a dead runner never blocks a content update.
- **Make staleness loud, not silent**: put version + built_at + age on `/health`;
  have your deploy/verify gate WARN on a stale or floor-only serving source (warn,
  not fail — a stale publish is not the code deploy's fault). Set the mutable
  pointer's cache to `no-cache` so a fresh publish is seen immediately.

## When this does NOT apply

- Content copied from the same build context, where the app commit changes with the
  content (image *is* the serving source) — then a redeploy is correct.
- Systems with no separate publisher/serving plane at all.

Pull the adjacent flavors of "the layer between you and the user is lying":

```js
search_lessons({ query: "deploy green but live content stale serving source cache", limit: 5 })
```

- [[lsn_verify_deploy_actually_shipped]] — the frontend flavor: confirm the new
  bundle actually shipped before debugging a "fix that didn't work".
- [[lsn_docker_build_git_clone_cache_bust]] — a build-time sibling: a moving-ref
  git clone cache-hits and bakes stale content into the image.
- [[lsn_public_asset_filename_versioning]] — a CDN/browser cache holds old bytes at
  a stable path; rename, don't redeploy.
- [[lsn_scheduled_workflow_cadence_burns_ci_quota]] — the cause side: a scheduled
  publishing job that stops because the CI quota ran out.
- [[lsn_github_actions_billing_exhausted_zero_step_fail]] — how that exhaustion
  looks in the Actions UI: ~2s jobs, zero steps, 404 logs.
