---
id: lsn_gh_pr_checks_watch_exit_zero_no_required
title: "Diagnose a merge that fires before CI — `gh pr checks --watch` exits 0 when no checks are registered"
type: debugging_lesson
tier: community
context:
  tools: [gh, github-actions]
  languages: [bash]
  platforms: [github]
  tags: [github, gh-cli, ci, automation, exit-codes, merge-automation]
summary: "`gh pr checks <branch> --required --watch` returns exit 0 immediately when the PR has no registered checks yet — the same exit code it returns when every required check passed. Automation that gates a merge on that exit code ships during the window between push and the first check registering, which on a busy Actions queue can be ten minutes. Poll for a terminal state of the EXPECTED check names instead of trusting the exit code."
---

## Symptom

A merge script waits for CI and proceeds immediately, seconds after the push:

```bash
gh pr checks "$BRANCH" --required --watch   # exits 0
echo $?                                     # 0  → script merges
```

The PR is not green. It has no checks at all yet. `--watch` had nothing to
watch, so it returned at once — with the exit code that also means success.

Printed output is the tell, and it is easy to discard in automation:

```
no required checks reported on the 'feat/my-branch' branch
```

That line goes to stdout while the exit code says 0. A script that reads only
`$?` — the normal thing to do — cannot distinguish it from a full green run.

## Root cause: the exit code conflates two states

`gh pr checks` returns non-zero when checks fail or are pending. It says nothing
useful about the *empty* case, and empty is not failure, so it exits 0. Three
real states collapse into two observable ones:

| Real state | Output | Exit |
|---|---|---|
| all required checks passed | table of checks | 0 |
| a required check failed / pending | table of checks | non-zero |
| **no checks registered yet** | `no required checks reported` | **0** |

The first and third are indistinguishable to `$?`.

## Why the window is wide enough to matter

This looks like a race you would never lose — the checks register on push,
surely. Two things widen it:

- **Queue delay.** On a busy runner pool the workflow run is *created* but not
  *started*, and checks register when jobs start. Observed on a normal weekday:
  **eleven minutes** between push and the first check appearing.
- **Path-filtered workflows.** A PR that touches no relevant path may register
  its checks late (a detect job runs first) or, in a misconfigured setup, never.
  "Never" is permanently indistinguishable from green by exit code.

Automation that ships right after `git push` sits exactly in this window. Retry
logic does not help if it is keyed on the exit code — the first attempt already
"succeeded".

## The fix: assert the expected NAMES reach a terminal state

Do not ask "did the command succeed". Ask "have the checks I require finished".
That requires knowing their names — which you do, because branch protection
lists them.

```bash
REQUIRED=(typecheck build)          # the names branch protection requires
DEADLINE=$(( $(date +%s) + 1800 ))

while :; do
  # -R is not optional: gh resolves the repo from the CWD, and a script whose
  # directory changed will confidently answer about a DIFFERENT repository.
  out=$(gh pr checks "$BRANCH" -R "$OWNER/$REPO" --json name,state 2>/dev/null) || {
    sleep 20; continue; }        # API flake is not a verdict

  missing=0
  for want in "${REQUIRED[@]}"; do
    echo "$out" | jq -e --arg n "$want" \
      'map(select(.name==$n and (.state=="SUCCESS" or .state=="FAILURE" or .state=="CANCELLED"))) | length > 0' \
      >/dev/null || missing=1
  done

  [ "$missing" -eq 0 ] && break
  [ "$(date +%s)" -gt "$DEADLINE" ] && { echo "timeout waiting for: ${REQUIRED[*]}"; exit 1; }
  sleep 20
done

echo "$out" | jq -e 'all(.state == "SUCCESS")' >/dev/null || { echo "not green"; exit 1; }
```

Three properties that matter and that the one-liner lacks:

1. **A check that never appears is a timeout, not a pass.** Absence is treated
   as "unknown", which is the honest reading.
2. **API errors are retried, not interpreted.** A failed HTTP call must never
   collapse into a verdict.
3. **The final assertion is on state, not on the exit code** of the waiting
   command.

### Quick manual check

Before trusting any waiting step, look at whether the checks exist at all:

```bash
gh pr checks "$BRANCH" -R "$OWNER/$REPO"      # empty table? nothing is registered
gh run list --branch "$BRANCH" --limit 5      # 'queued' means created, not started
```

`queued` runs with no visible checks are the exact state that returns exit 0.

## When this does NOT apply

- **Merge queues / `gh pr merge --auto`.** GitHub itself holds the merge until
  required checks report; the empty state cannot slip through because the
  server, not your script, enforces it. Prefer this where available.
- **Repos with no required checks configured.** Then "no required checks" is the
  permanent truth, and gating on them is the wrong design — the gate belongs
  elsewhere.
- **Interactive use.** A human reads `no required checks reported` and
  understands it instantly. The trap is specific to reading `$?`.
- **`gh pr checks` without `--watch`** already returns immediately; the surprise
  is smaller, but the exit code conflates the same two states.

## Related

Retrieve from the symptom:

```
search_lessons({ query: "gh pr checks watch exit 0 no required checks merge too early", platforms: ["github"] })
```

- [[lsn_shell_pipe_breaks_command_chain_error_handling]] — the adjacent
  exit-status trap: piping to `tail` discards the status of the stage you cared
  about, so `&&` proceeds after a failure.
- [[lsn_worktree_gitignored_config_wrong_target]] — the sibling *target*
  confusion, and the reason `-R` appears in the loop above: a CLI answering
  confidently about something other than what you meant.
