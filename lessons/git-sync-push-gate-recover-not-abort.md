---
id: lsn_git_sync_push_gate_recover_not_abort
title: "Diagnose a git-sync 'Sync failed at push step' abort — the pre-flight process gate must recover, not return"
type: debugging_lesson
tier: community
summary: "A git-sync script that gates each step behind a 'wait until no git process runs' pre-flight wrongly aborts the push when a transient concurrent git op (editor autofetch, parallel session, iCloud-slowed) outlives the wait budget — though the commit already sits safely local. git push takes no index.lock and isn't blocked by read-only status/diff/fetch, and the early return also skips the whole post-push recovery ladder. Fix: on timeout, sweep zombies + clean locks, then push anyway."
context:
  tools: [git]
  languages: [python, bash]
  platforms: []
  tags: [git, sync-script, automation, push, pre-flight, daily-driver, concurrency]
---

## Symptom

An auto-sync script (`pull` -> `add` -> `commit` -> `push`) completes every step but the last, and dies with a message like:

```
Git Push...
Waiting for any running Git process.......... Timeout waiting for Git process.
Git process still running, cannot push.
Sync failed at push step
```

The commit already exists — `git rev-list --left-right --count @{u}...HEAD` shows the branch **1 ahead**. Nothing is lost; the sync just left the repo silently unpushed. Re-running usually "works", which hides the bug.

## Root cause

The script gates each step behind a pre-flight that polls for other running git processes and bails if one is still active:

```python
def wait_for_git(repo_path, retries=10, wait=2):   # 10 x 2s = 20s budget
    ...

def git_push(...):
    if not wait_for_git(repo_path):
        print("Git process still running, cannot push.")
        return False        # <-- aborts the whole sync at the last step
    ...
```

`is_git_running()` flags any process whose command line contains the repo path **and** a mutating verb (`fetch`/`pull`/`push`/`commit`/...). A **`git fetch`** started by the editor's autofetch, a parallel agent session, or an iCloud-slowed operation matches that filter. If it lives longer than the 20-second budget, `wait_for_git` returns `False` and the push is refused — even though the blocker is harmless.

Two things make this worse than a normal retry-later:

1. **`git push` does not need this gate at all.** Push does not take `.git/index.lock`, and it is not blocked by a concurrent read-only `git status`/`git diff`, nor by a `git fetch` (fetch writes remote-tracking refs under its own lock, momentarily at most). A lingering editor query *cannot* corrupt or block a push. So waiting for it and then aborting is pure downside.
2. **The abort skips the recovery it already has.** The elaborate post-push handling below the gate — timeout retry with a longer budget, SIGBUS/pack-materialization recovery, a remote-ref false-negative check ("the push actually landed, the server response just hung") — is **dead code** when the pre-flight returns early. The last and most valuable step fails hardest and does the least to save itself.

There is also a threshold gap: a Phase-0 sweep that only kills git zombies older than, say, 10 minutes will not touch a process that has been stuck for 90 seconds — but 90 seconds is already more than enough to blow a 20-second wait budget. Any process in the (wait-budget, stale-threshold) band guarantees a false abort.

## Detect

```bash
# Did the commit make it locally? (ahead>0, behind=0 => only the push was skipped)
git rev-list --left-right --count @{u}...HEAD

# What was actually holding the repo "busy"? Usually a read-only query or autofetch:
pgrep -fl git
```

If the culprit is a `git status`/`git symbolic-ref`/`git fetch`, it never justified blocking the push.

## Fix: recover-and-proceed instead of return-False

On a pre-flight timeout, run the **same** cleanup the mutating steps already use (kill genuinely-stale zombies, drop stale locks), then attempt the push anyway. Let git's own ref-lock serialize if a real concurrent push exists, and let the post-push handler catch a genuine hang:

```python
def git_push(...):
    if not wait_for_git(repo_path):
        # Gate expired -> do NOT abort. push needs no index.lock and is not
        # blocked by read-only status/diff/fetch. Sweep + try anyway; the
        # post-push timeout/SIGBUS handler below catches a real hang, and a
        # genuine concurrent push ends in a clean non-fast-forward, not corruption.
        print("Process gate expired -> zombie-sweep + push attempt anyway...")
        kill_stale_git_processes(repo_path, max_age_minutes=2)
        clean_stale_locks(repo_path)

    result = run_command(f"git push -u origin {branch}", cwd=repo_path, timeout=300)
    # ... existing timeout-retry / SIGBUS-recovery / remote-ref false-negative check ...
```

The failure modes after "try anyway" are all safe and self-reporting:

| Outcome | What happens |
|---|---|
| Blocker was harmless (the common case) | Push succeeds normally |
| Real concurrent push landed first | Non-fast-forward rejection -> reported, resolved by the next pull/rebase |
| Genuine local hang (iCloud pack mmap) | Caught by the post-push timeout/SIGBUS ladder that was previously skipped |

## When this does NOT apply

Keep the gate where it earns its place — this is **push-specific**. `git add`/`git commit` **do** take `index.lock`, so waiting there is legitimate; but those steps should *also* recover-and-retry rather than hard-abort, and aborting *before* a commit is at least harmless (no half-committed state, nothing to sync yet). The asymmetric, expensive failure is uniquely the push: the work is already committed, and the abort strands it. Beyond that:

- **CI runners / fresh-checkout automation** — no long-lived working tree, no editor autofetch, no parallel sessions sharing the tree. The concurrent-process gate rarely fires and the whole class of blocker is absent.
- **A gate in front of an operation that truly needs the index lock** (`add`, `commit`, `reset`, `checkout`) — there, waiting is correct; make it recover-and-retry, don't remove it.
- **A hang that is really your own repo corruption** — if `git push` itself hangs on an iCloud-evicted pack, that is the post-push SIGBUS/timeout path's job, not the pre-flight gate's.

## Related

- [[lsn_git_sync_script_branch_aware_pull]] — the pull-side sibling: hardcoded `git pull` fatally aborts on a branch with no upstream; probe `@{u}` and policy-dispatch instead of aborting the pipeline. Same principle (never let one edge case kill the whole sync), different git operation.

```typescript
search_lessons({
  query: "git sync script push pre-flight wait for git process false abort recover",
  tools: ["git"],
  tags: ["sync-script", "push", "pre-flight"],
});
```