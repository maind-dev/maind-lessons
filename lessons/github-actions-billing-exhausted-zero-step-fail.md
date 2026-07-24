---
id: lsn_github_actions_billing_exhausted_zero_step_fail
title: "GitHub Actions jobs failing in ~2s with zero steps and 404 logs are billing-exhausted, not broken"
type: debugging_lesson
tier: community
context:
  tools: [git]
  languages: []
  platforms: [github-actions]
  tags: [github-actions, ci, billing, false-red, diagnosis]
summary: >
  When a GitHub Actions run reports "failure" within ~2-3 seconds with zero
  executed steps and its job logs 404 (BlobNotFound), the job was created but
  never assigned to a runner — the account's Actions minutes / spending limit is
  exhausted. It is not your YAML and not your code. Distinguish it from a real
  failure with three probes before touching either.
---

## Symptom

A required check on a PR goes red almost instantly. Opening the run shows a job
with **conclusion: failure**, **~2-3 s duration**, and **0 steps executed**.
Fetching the job logs returns HTTP 404 with an XML `BlobNotFound` body — there
are no logs because nothing ran. The job was queued and immediately failed at
assignment, never reaching a runner.

This is the signature of **exhausted Actions billing** (spending limit hit, or
the included-minutes quota is spent). It looks identical to a broken build if you
only glance at the red X.

## Three probes to classify it (before debugging code or YAML)

Run these — they cleanly separate the three causes (billing / broken workflow
file / broken code):

```bash
# 1. Zero-step + instant fail? → not a code or step failure (nothing ran)
gh api "repos/OWNER/REPO/actions/runs/$RUN_ID/jobs" \
  --jq '.jobs[] | {name, conclusion, steps: (.steps|length), started_at, completed_at}'
# billing signature: steps == 0, completed ~2-3s after started

# 2. run.name = the DECLARED workflow name, not a file path? → NOT a YAML parse error
gh api "repos/OWNER/REPO/actions/runs/$RUN_ID" --jq '.name'
# A malformed workflow file surfaces the PATH (.github/workflows/x.yml) as the name
# and produces a "workflow file issue" annotation instead of a queued job.

# 3. Same workflow red on the DEFAULT branch too? → systemic, not your branch
gh run list --repo OWNER/REPO --workflow ci.yml --limit 5 \
  --json conclusion,headBranch,createdAt \
  --jq '.[] | "\(.createdAt[0:16]) \(.headBranch): \(.conclusion)"'
# If master/main fails identically on commits you never touched → account-level, not code.
```

If all three point the same way (0 steps, declared-name, default-branch also
red), stop debugging your diff — the runner never ran it.

## Why it is worth a named check

The instinct on a red required check is to read the diff. Here the diff is
irrelevant: the code was never compiled, the tests never started, the YAML is
fine. Hours get lost "fixing" a build that never executed. The 404-logs +
zero-steps + default-branch-parity triad is unambiguous once you know to look
for it.

Contrast with the adjacent trap: an **unquoted colon in a step name**
(`name: Build (CI: fast)`) makes GitHub reject the whole file and run **zero
jobs** with a "workflow file issue" — there `run.name` is the file path, not the
declared name. See [[lsn_github_actions_step_name_unquoted_colon]]; probe 2 is
what separates the two.

## What to do while billing is down

You cannot make Actions run without restoring billing (raise the spending limit
or wait for the monthly reset). But the check being red need not block you:

- Run the equivalent battery **locally** — the agent/developer is the runner
  (`pnpm typecheck`, tests, drift gates, a local review gate). A green local
  battery is the real signal; the red CI check is infrastructure noise.
- If you merge past the red check, do it with explicit human authorization and a
  note that the red is billing, not code — never with `--admin` bypass as a habit.
- Fresh-checkout jobs (Vercel/Netlify previews, other providers) are billed
  separately and keep passing — their green is unrelated to the Actions red.

## When this does NOT apply

- Steps **did** execute (`steps|length > 0`) and one failed with real logs →
  genuine failure, read the logs.
- `run.name` is a file path + a "workflow file issue" annotation → malformed
  workflow YAML, not billing (probe 2).
- The default branch is green and only your branch is red → likely your change;
  the account has minutes.
- Self-hosted runners → "no minutes" doesn't apply the same way; look at runner
  availability/labels instead.

Surface this and its sibling with:

```js
search_lessons({ query: "github actions job failed instantly zero steps billing", platforms: ["github-actions"] })
```
