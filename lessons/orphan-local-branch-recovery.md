---
id: lsn_orphan_local_branch_recovery
title: "Diagnose `fatal: couldn't find remote ref` on a local branch with unique commits — full recovery recipe"
type: debugging_lesson
tier: community
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: []
  tags: [git, branch-recovery, orphan-branch, stash, parallel-sessions, sync-script-failure]
summary: "`git pull` fails with `couldn't find remote ref <branch>` when the current local branch has no upstream. If the branch carries unique commits, `git branch -D` destroys them silently. Recovery: reflog for origin-forensics, `git log master..HEAD` for commit-inventory, `merge-base --is-ancestor` for ff-check, then `stash -u` → `switch master` → `merge --ff-only` → `branch -d` → `stash pop`."
problem: |
  A git-sync script or a developer's manual `git pull` aborts with:

  ```
  fatal: couldn't find remote ref test/feature-x
  ```

  Investigation shows the working copy is on a local branch `test/feature-x`
  that has no upstream (`git rev-parse --abbrev-ref @{u}` returns nothing).
  The branch was created by a previous session — sometimes the user's own
  earlier AI-agent run, sometimes a quick `git switch -c` that never got
  pushed. Either way, the user often doesn't remember the branch existed.

  Two failure modes hide inside this situation:

  1. **Naive `git branch -D test/feature-x`** to "clean up" — if the branch
     carries unique commits not on main/master (a release commit, a partial
     refactor, a WIP draft), they are destroyed silently. `branch -D` is
     force-delete, no safety check.
  2. **Bare `git switch master` first** — if the working tree has
     uncommitted edits that overlap with files differing between the two
     branches (e.g. `package.json` after a version bump), the switch aborts
     with "your local changes would be overwritten by checkout".

  The diagnostic question is "what's on this branch, and how does it relate
  to master?" — and the answer determines whether cleanup is safe.
solution: |
  Five-step recovery sequence — diagnose first, act second:

  **Step 1: Diagnose origin via reflog**

  ```bash
  git reflog --date=iso | head -20
  ```

  Look for the `checkout: moving from <X> to <branch>` entry. The timestamp
  tells you when the branch was created; `<X>` tells you the source.

  **Step 2: Inventory unique commits**

  ```bash
  git log master..HEAD --oneline    # commits on branch, NOT on master
  git log HEAD..master --oneline    # commits on master, NOT on branch
  ```

  If `master..HEAD` is empty: branch has no unique work, safe to delete.
  If `HEAD..master` is empty: fast-forward to master would lose nothing.
  If both have commits: divergent history, requires merge or rebase decision.

  **Step 3: Verify fast-forward eligibility**

  ```bash
  git merge-base --is-ancestor master HEAD && echo "FF possible" || echo "DIVERGENT"
  ```

  This returns success (exit 0) when master is a direct ancestor of HEAD,
  meaning we can fast-forward master to HEAD without losing master commits.

  **Step 4: Stash any uncommitted edits (with `-u` for untracked files)**

  ```bash
  git stash push -u -m "wip: pre-branch-cleanup $(date +%Y-%m-%d)"
  ```

  The `-u` flag is critical — bare `git stash` silently drops untracked
  files.

  **Step 5: Switch → FF-merge → safe-delete → pop**

  ```bash
  git switch master
  git merge --ff-only <orphan-branch>     # master now points to branch's tip
  git branch -d <orphan-branch>            # `-d` (not `-D`) refuses if anything would be lost
  git stash pop                            # restore uncommitted edits
  ```

  After this sequence:
  - All unique commits from the orphan branch are now on master
  - The orphan branch is gone
  - The working tree is back to its pre-cleanup state (modified + untracked files restored)
  - `master` is one or more commits ahead of `origin/master` (the unique commits await a push)

  The sync-script can now `git pull` master successfully on next run.
gotchas:
  - "`git branch -d` (lowercase) is the safe-delete — refuses if the branch has unmerged commits. `-D` (uppercase) is force-delete. Use `-d` after the ff-merge so git verifies for you that nothing is lost."
  - "`merge --ff-only` will fail if the branches diverged. If that happens, the orphan branch has commits that master doesn't AND master has commits the orphan doesn't — pick `git merge` (with merge commit) or `git rebase` instead, but those need a separate decision about history-shape."
  - "If `git stash pop` produces conflicts (rare for pure branch-switch), the stash entry is preserved — `git stash list` still shows it. Resolve conflicts, then `git stash drop` only after you're satisfied."
  - "If the orphan branch was created from a stale master, master may have moved on. Fast-forward then becomes impossible. Check `git log HEAD..master --oneline` — if non-empty, you need merge or rebase, not ff-only."
  - "Don't push to remote until you've reviewed what `master` now contains. `git log -5` plus `git diff HEAD~3 -- <key-files>` before any `git push`."
last_validated_at: "2026-05-28"
---

## Symptoms that map to this recovery

| Symptom | Likely cause |
|---|---|
| `git pull`: `fatal: couldn't find remote ref <branch>` | Current branch has no upstream — orphan local |
| `git switch master`: `local changes would be overwritten` | Working tree has edits overlapping with branch-differing files |
| `git branch -d <branch>`: `not fully merged` | Branch carries unique commits — safe-delete refused, good |
| `git log master..HEAD` returns commits | Unique work exists on the branch; protect before any cleanup |

## Diagnosis cheat-sheet

```bash
# Where am I?
git status -sb

# Where did this branch come from? (reflog forensics)
git reflog --date=iso | head -20

# What's unique on this branch vs master?
git log master..HEAD --oneline
git log HEAD..master --oneline

# Is fast-forward possible?
git merge-base --is-ancestor master HEAD && echo "FF" || echo "DIVERGENT"

# What's in the working tree?
git status                 # tracked changes
git ls-files --others --exclude-standard   # untracked files
```

Run all of these BEFORE any destructive action. The combined output
tells you whether the recovery recipe is safe or whether you need
merge / rebase / further investigation.

## The recipe (when ff-eligible + uncommitted overlap)

```bash
# 1. Stash everything (including untracked)
git stash push -u -m "wip: pre-branch-cleanup $(date +%Y-%m-%d)"

# 2. Switch to master
git switch master

# 3. Fast-forward master to the orphan branch's tip
git merge --ff-only <orphan-branch>

# 4. Safe-delete the orphan branch (refuses if anything would be lost)
git branch -d <orphan-branch>

# 5. Restore uncommitted edits
git stash pop
```

## When NOT to use this recipe

- **Branches with diverged history** — if `git log HEAD..master` is non-empty AND `git log master..HEAD` is non-empty, both have unique commits. Fast-forward will fail. Decide on merge-vs-rebase based on whether you want history-preservation or linear history.
- **Branches you want to keep as feature branches** — if the orphan branch is a legitimate ongoing feature, the right move is `git push -u origin <branch>` to make it a tracked feature branch, not consolidation into master.
- **Branches with WIP that should NOT land on master yet** — commit the WIP to the branch, push with `-u`, continue work. Don't merge half-finished work just to escape the sync-script error.

## Real-world example

From a 2026-05-28 incident: a sync-script aborted with the "couldn't
find remote ref" error. Reflog showed the orphan branch was created
~5 hours earlier by a previous AI-agent session (the branch name
referenced a documented but unrelated release-flow test). The branch
had one unique commit (a release version-bump), and the working tree
had an unrelated `package.json` edit. The recipe above recovered
cleanly: ff-merge brought the release commit onto master, the orphan
branch was safe-deleted, and the working tree was restored.

## Discovering related conventions

```typescript
// To find the diagnostic primitive (reflog as forensics tool):
search_lessons({ query: "git reflog branch forensics", tools: ["git"] });

// To find the data-safety primitive (stash -u for branch-switch):
search_lessons({ query: "git stash push untracked branch switch" });

// For broader parallel-session state-drift awareness:
get_lesson({ id: "lsn_parallel_sessions_first_ask" });
```

For the broader pattern of solo-dev sessions creating state-drift
over time, see [[lsn_parallel_sessions_first_ask]].