---
id: lsn_git_stash_u_branch_switch_pattern
title: "Default to `git stash push -u` before branch-switch — bare stash silently drops untracked files"
type: workflow_best_practice
tier: community
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: []
  tags: [git, stash, branch-switch, working-tree, data-safety]
summary: "`git stash push -u -m \"<reason>\"` is the safe default before any branch-switch / merge / branch-op with uncommitted edits. The `-u` flag includes untracked files — bare `git stash` silently drops them, then `stash pop` restores only what was tracked. The data-loss is invisible until you look for files that were never staged."
problem: |
  An agent (or a developer) wants to switch branches but the working tree
  has uncommitted changes. `git switch` aborts with "your local changes
  would be overwritten by checkout". The reflex is to stash and retry:

  ```bash
  git stash
  git switch <other-branch>
  # ... do stuff ...
  git stash pop
  ```

  This works for tracked files. But any untracked file (e.g. a new
  `.md` draft, a new test file, a new migration created in this session)
  is NOT included in the bare stash. It stays in the working tree during
  the switch — except that the new branch may already have a file at
  that path, or `git switch` may move the file to the new branch's
  workspace context. Either way, after `stash pop` the file is gone or
  inconsistent, with no visible error.

  The failure mode is silent because git does not warn about untracked
  files not being stashed. The user only notices when they look for a
  file that was "in progress" and find it missing or modified.
solution: |
  Make `-u` the unconditional default for branch-cleanup-related stashing:

  ```bash
  git stash push -u -m "wip: <one-line reason>"
  git switch <other-branch>
  # ... do branch op ...
  git stash pop
  ```

  Three things this fixes vs. bare `git stash`:

  1. **`-u` (`--include-untracked`)** — untracked files are stashed too.
     The new branch starts with a clean working tree; pop restores
     everything to its pre-stash state.
  2. **`-m "<reason>"`** — a human-readable label on the stash entry.
     Critical when `git stash list` accumulates entries from multiple
     sessions — without labels you can't tell which is which.
  3. **`push` verb** — the modern stash syntax. The legacy `git stash`
     command still works but lacks the explicit subcommand vocabulary;
     `push` aligns with `pop`, `apply`, `drop`, `show`.

  After the branch op, `git stash pop` restores everything. If there
  are conflicts (rare for pure branch-switch cases), resolve them as
  normal merge conflicts. If you want to inspect first without
  applying: `git stash show -p` shows the diff.
gotchas:
  - "If a `.gitignore` rule excludes a file you DO want stashed, `-u` won't include it — you need `-a` (`--all`) which includes ignored files too. Use `-a` for cleanroom scenarios where even ignored files need to round-trip."
  - "`git stash pop` deletes the stash entry on success. If you want to apply but keep the entry (e.g. to apply to another branch later), use `git stash apply` instead."
  - "Stashed entries are NOT pushed to remote. A `git stash` then `clone` elsewhere does not carry the stash. If you need to share WIP across machines, commit to a wip-branch instead."
  - "If a stash pop produces conflicts and you want to abort and start over: `git checkout -- .` discards the working-tree merge state, but the stash entry is NOT auto-restored — `git stash show -p stash@{0}` confirms the stash still exists."
last_validated_at: "2026-05-28"
---

## The default `-u` rule

For any branch-cleanup-adjacent operation with uncommitted edits, the
default is `git stash push -u -m "<reason>"`. Don't reach for bare
`git stash` — the silent untracked-file drop is the worst kind of
data loss because it doesn't surface until you go looking for what's
missing.

## Why bare stash loses untracked work

Bare `git stash` is documented as "stash tracked files" — untracked
files are left alone in the working tree. During a subsequent `git
switch`, those untracked files can be:

- Lost if the target branch has a tracked file at that exact path
- Modified silently by branch-checkout merging logic
- Carried over inconsistently (still untracked, but the surrounding
  context is now a different branch's tree)

After `git stash pop`, only the tracked files are restored. The
untracked-file situation is whatever the post-switch + post-pop
sequence happened to produce. No warning, no error message — you
have to know to check.

## Pop conflict resolution

If `git stash pop` reports conflicts:

```bash
# Inspect the conflict
git status                      # see which files are merged
git diff                        # see the conflict markers

# Resolve in your editor, then:
git add <resolved-files>
git stash drop                  # only after you're satisfied with the result
```

The stash entry stays in `git stash list` until you explicitly drop
it. This is a safety net — if the resolution went wrong, you can
re-apply from the entry.

## When NOT to stash

If the working tree is clean (`git status` is empty), you don't need
to stash before switching — git will just switch. Stashing a clean
tree creates an empty entry that adds noise to `git stash list`.

If the changes are committable as-is, prefer `git commit -m "wip: ..."`
on a wip-branch over stashing. Commits survive `clone`, `push`, and
`stash drop`; stashes don't.

## Full sequence as a copy-paste recipe

For a branch-cleanup where you need to switch off the current branch,
do a branch op, then come back:

```bash
git stash push -u -m "wip: pre-branch-cleanup $(date +%Y-%m-%d)"
git switch <target-branch>
# ... branch op (merge, delete, ff-merge, etc.) ...
git switch -    # or git switch <original-branch>
git stash pop
```

The `git switch -` shorthand returns to the previous branch — handy
when you don't want to type the original name again.