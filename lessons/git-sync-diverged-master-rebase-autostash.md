---
id: lsn_git_sync_diverged_master_rebase_autostash
title: "Diagnose a diverged trunk in an ff-only sync-script — recover with `git pull --rebase --autostash`"
type: debugging_lesson
tier: community
summary: "An ff-only sync-script aborts with 'Remote ist divergiert' / 'Not possible to fast-forward' when the local trunk is simultaneously ahead (a direct commit from an agent session) and behind (PRs merged on the hosting platform). With a dirty working tree, the one-line recovery is `git pull --rebase --autostash` — a bare `git pull --rebase` fails on unstaged changes. Root-cause the local-ahead commit: on a PR-only trunk it usually means a session committed directly to the shared tree."
context:
  tools: [claude-code, cursor, windsurf]
  languages: [bash, python]
  platforms: []
  tags: [git, sync-script, divergence, rebase-autostash, parallel-sessions, pr-workflow]
---

## Symptoms that map to this recovery

| Symptom | Likely cause |
|---|---|
| Sync-script aborts at the pull step with a divergence message | `git pull --ff-only` refused: local branch is ahead AND behind its upstream |
| `git status -sb` shows `[ahead N, behind M]` | Local-only commits + remote-only commits — no fast-forward possible |
| Trunk is PR-only, but `git log origin/master..master` is non-empty | A session (often an AI agent) committed directly to the shared trunk |
| `git pull --rebase` fails with `cannot rebase: You have unstaged changes` | Dirty working tree — the shared daily-driver tree almost always is |

This is the third failure mode of the sync-script family, distinct from
[[lsn_git_sync_script_branch_aware_pull]] (branch has NO upstream →
`couldn't find remote ref`) and [[lsn_orphan_local_branch_recovery]]
(orphan branch with unique commits). Here the branch HAS an upstream —
the two sides have simply grown apart. The orphan-recovery convention
stops at "decide merge-vs-rebase" for diverged history; this is the
recipe for the common sync-script case.

## Diagnosis — 30 seconds, read-only

```bash
git fetch origin
git status -sb                              # ## master...origin/master [ahead 1, behind 3]
git log --oneline origin/master..master     # what exists ONLY locally (never pushed)
git log --oneline master..origin/master     # what exists ONLY on the remote
```

Then check whether the two sides touch the same paths (predicts rebase
conflicts):

```bash
comm -12 \
  <(git diff --name-only origin/master...master | sort) \
  <(git diff --name-only master...origin/master | sort)
# empty output = no path overlap = rebase will almost certainly be clean
```

Real-world instance (2026-07-04): local master was ahead 1 (a feature
commit an agent session made directly on the shared tree) and behind 3
(PRs merged on GitHub in parallel). The local commit touched only one
project directory, the remote commits touched others — zero overlap.

## The recovery

```bash
git pull --rebase --autostash
```

One command, three effects: stashes the dirty working tree (the shared
tree had ~51 uncommitted files), replays the local-only commit(s) on top
of the remote commits, restores the stash. Afterwards the branch is
`[ahead N]` only — fast-forward pulls work again, and the next
sync-script run pushes the replayed commit.

`--autostash` is the load-bearing flag. A bare `git pull --rebase`
refuses to start on a dirty tree, and the manual
`stash → rebase → stash pop` dance is three failure points instead of
one. If the rebase does hit conflicts, `git rebase --abort` restores the
pre-rebase state INCLUDING the autostash.

Verification:

```bash
git status -sb            # [ahead N] only, no "behind"
git log --oneline -5      # local commit now sits on top of the remote ones
git stash list            # empty — autostash was re-applied, not stranded
```

## Don't stop at the symptom — root-cause the local-ahead commit

On a PR-only trunk (trunk grows exclusively via PR merges), a local-only
commit on the trunk is itself the bug. Typical source: an AI-agent
session that implemented a feature and committed to the shared tree
instead of a feature worktree/branch. Two structural fixes:

1. **Sync-script: guided recovery instead of a bare abort.** When
   `--ff-only` fails, print the ahead/behind counts and both commit
   lists, compute the path overlap, and (interactive only) offer
   `git pull --rebase --autostash` — default Yes when overlap is empty,
   default No when it isn't. Keep non-interactive/cron runs aborting;
   auto-rebase without a human is how you replay a commit nobody wanted.
2. **Pre-commit guard on the trunk.** In the shared tree, reject
   commits on the trunk branch unless an allow-marker is set (e.g. the
   sync-script exports `GIT_SYNC_COMMIT=1` for its own commits). The
   guard's error message should point to the feature-worktree workflow.
   This turns "agent quietly diverged the trunk" into an immediate,
   explained failure at commit time.

## When this does NOT apply

- **The local-ahead commits are wanted on a branch, not the trunk** —
  don't rebase them onto the trunk. `git branch feat/x <sha>` +
  `git reset --hard origin/master` (after stashing) moves them out.
- **Path overlap is large or the local commits are many** — the rebase
  may conflict repeatedly. Consider `git merge` (preserves history, one
  conflict resolution) or moving the local work to a branch and opening
  a PR like everything else.
- **Trunk allows direct commits by policy** (solo trunk-based dev, no
  PR gate) — divergence is then routine; configure
  `git config pull.rebase true` + `rebase.autoStash true` and let plain
  `git pull` handle it instead of an ff-only script.
- **The remote side was force-pushed** — ahead/behind counts lie about
  intent; investigate with `git reflog origin/master` before rebasing
  onto rewritten history.

## Discovering related vetted conventions

```typescript
// The no-upstream sibling failure (couldn't find remote ref):
get_lesson({ id: "lsn_git_sync_script_branch_aware_pull" });

// Orphan branch with unique commits (the ff-eligible cousin):
get_lesson({ id: "lsn_orphan_local_branch_recovery" });

// Why the stray trunk commit happened in the first place:
get_lesson({ id: "lsn_solo_dev_parallel_agent_state_drift" });
```

Cross-refs: [[lsn_git_sync_script_branch_aware_pull]] (pull pre-flight
family), [[lsn_orphan_local_branch_recovery]] (no-upstream variant),
[[lsn_cross_project_sync_script_pattern]] (the sync-script this
hardens), [[lsn_solo_dev_parallel_agent_state_drift]] and
[[lsn_parallel_sessions_first_ask]] (the parallel-session root cause).