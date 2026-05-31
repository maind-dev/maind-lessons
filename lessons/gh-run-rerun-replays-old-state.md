---
id: lsn_gh_run_rerun_replays_old_state
title: 'CI check fails identically after a fix: `gh run rerun` replays the OLD workflow + code, not your update'
type: debugging_lesson
tier: community
context:
  tools:
    - gh
  languages: []
  platforms:
    - github
  tags:
    - github-actions
    - ci
    - gh-cli
    - debugging
summary: "After fixing a validator or workflow file, re-running a previously-failed check with `gh run rerun <id>` replays the run in its ORIGINAL state — same workflow definition, same code context — so it fails the same way and looks like your fix did nothing. To exercise the fix you must trigger a FRESH run: push a new commit, reopen the PR (synchronize/reopened), or regenerate the PR. Confirm the failure MESSAGE changed, not just red-vs-green."
last_validated_at: "2026-05-30"
---
## The trap

You fix the CI validator (or the workflow YAML, or the base-branch code a check reads), then `gh run rerun <run-id>` on the failed check — and it fails identically. The conclusion "my fix didn't work" is wrong: the rerun replayed the run as it was, with the workflow and code from that run's commit context, not your updated state.

Tell: the failure log shows the OLD error message (e.g. the old validator's wording), proving the new code never ran.

## What actually picks up the fix

A FRESH workflow run, triggered by a real event — not a rerun:

```bash
# WRONG: replays the original run state, ignores your fix
gh run rerun <run-id>

# RIGHT: trigger a fresh run against the current base
git commit --allow-empty -m "ci: re-trigger" && git push   # -> synchronize
# or, to re-run with the current workflow file:
gh pr close <n> && gh pr reopen <n>                         # -> reopened
```

For `pull_request` workflows, the workflow definition and merge-ref come from the current base at run time — so a fresh run picks up a base-branch fix; a rerun does not. When the head commit itself must change (e.g. to add a missing commit trailer), regenerate the PR (delete branch, recreate).

## Generalization

This is one instance of a broader rule: when "the fix didn't take", verify you are testing against the actually-current state, not a cached or replayed one. The same trap appears with Postgres function bodies (verify the live body — [[lsn_postgres_verify_live_function_body]]) and with serverless env vars (a new value needs a redeploy, not just a save).

## When this does not apply

- `gh run rerun --failed` to retry a *flaky* job (network blip) is legitimate — there you WANT the same state, just another attempt.
- If you changed only repository or org *settings* (not code or workflow), a rerun may suffice, since settings are read live.
