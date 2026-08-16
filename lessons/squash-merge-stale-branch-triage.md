---
id: lsn_squash_merge_stale_branch_triage
title: "Squash-merge leaves every branch behind — triage stale branches by PR state and content, never by git's merge detection"
type: workflow_best_practice
tier: community
summary: "Under a squash-merge workflow, git's own merge detection is structurally blind: the squash mints a new commit with a new patch-id, so `git branch --merged` never lists the branch and `git cherry` reports phantom unmerged commits forever. The PR state is the reliable signal. For deletion, verify in three tiers — PR MERGED, ancestry, or byte-identical content of every touched file — and for branches without a PR, check whether the substance landed, not the bytes."
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: [git, github]
  tags: [git, squash-merge, branch-hygiene, cleanup, parallel-sessions, verification]
---
## Why stale branches accumulate under squash-merge

A squash-merge takes the branch's commits and mints **one new commit** on the
target branch — new SHA, new patch-id. Nothing in git links that commit back to
the branch it came from. Two consequences:

1. **The branch is never deleted implicitly.** Unless the merge path deletes it
   (`gh pr merge --delete-branch`, a repo's delete-on-merge setting, or a promote
   script), it stays — locally AND on the remote.
2. **git's merge detection reports it as unmerged forever.**
   `git branch --merged` skips it, `git merge-base --is-ancestor` says no, and
   `git cherry master <branch>` lists its commits as `+` (unmerged) although the
   content landed months ago.

Measured on one repo (2026-08-15): 26 local and 56 remote branches, of which
exactly **one** carried work that existed nowhere else. Six of the merged
branches showed up to "15 commits not in master" via `git cherry` — all phantom.

## The reliable signal is the PR state

```bash
gh pr list --state all --head "$branch" --limit 1 --json state --jq '.[0].state'
# MERGED → content is in the target branch, regardless of what git cherry says
```

The PR is the artifact that recorded the squash. Treat `git cherry` /
`--merged` output on squash-merged branches as noise, not as signal.

## Deletion needs three tiers of verification

A cleanup script should refuse to delete anything it cannot prove safe. Three
checks, in order — any single pass clears the branch:

```bash
# (a) PR merged?
state=$(gh pr list --state all --head "$b" --limit 1 --json state --jq '.[0].state')
# (b) full ancestor of the target? (covers merge-commit landings)
git merge-base --is-ancestor "$b" master
# (c) every file the branch touched is byte-identical in master?
base=$(git merge-base master "$b"); same=1
while IFS= read -r f; do
  git diff --quiet "master:$f" "$b:$f" 2>/dev/null || { same=0; break; }
done < <(git diff --name-only "$base" "$b")
```

Tier (c) exists because content can land **via a different branch**: a
cherry-pick onto a fresh branch merged under another PR passes neither (a) nor
(b), yet nothing would be lost. Without it, a verifier either skips such
branches forever or a human deletes them on gut feeling.

## Branches without any PR: substance check, then tag or ship

Never-shipped branches fail all three tiers even when their idea landed later
in reworked form. Byte comparison is the wrong question there — ask whether the
**thing** exists in the target branch:

- a branch adding a git hook → does `.githooks/<hook>` exist in master?
- a branch adding a doc section → does the section's heading exist in the file?
- a branch fixing session recovery for error `-32001` → `grep -c 32001` in the
  files that own that logic today.

If the substance landed, delete. If it did not, that branch is the rare real
find — ship it, or preserve it as an **archive tag** instead of a branch when
you will not merge it (an abandoned experiment with diagnostic value):

```bash
git tag -a "archive/<name>" "origin/<branch>" -m "why it was kept"
git push origin "archive/<name>" && git push origin --delete "<branch>"
```

The commits stay reachable, the branch list stays honest.

## Prevention and discovery

- Enable delete-on-merge (repo setting, or `gh pr merge --squash --delete-branch`).
- Promote scripts should clean up worktree + local branch + remote branch in the
  same step that merges — see [[lsn_merge_cleanup_strands_agent_cwd_and_tree]]
  for the cwd trap when they do.

```
search_lessons({
  query: "stale branches after squash merge cleanup safe delete",
  platforms: ["github"],
  tags: ["branch-hygiene"]
})
```

## When this does NOT apply

- **Merge-commit workflows**: the branch tip IS an ancestor of the target, so
  `git branch --merged` works — use it.
- **Rebase-merge workflows**: patch-ids survive, `git cherry` is meaningful.
- **A branch with an OPEN PR** is not stale, whatever its age — triage the PR,
  not the branch ([[lsn_rebase_vs_merge_integration]] for the update strategy).
- **Orphan local branches with unique commits** are a different recovery:
  [[lsn_orphan_local_branch_recovery]].
