---
id: lsn_cherry_pick_merge_commit_mainline
title: "Fix `git cherry-pick` failing with 'is a merge but no -m option was given' — pass `-m 1`, carry parent-count in tooling"
type: debugging_lesson
tier: community
summary: "`git cherry-pick <sha>` on a merge commit (true PR merges have 2 parents) always fails with 'is a merge but no -m option was given' — a diff is undefined without a mainline. Squash-merges are single-parent and fine, so the trap only fires on merge-commit workflows. Fix: pass `-m 1` (diff vs first parent = what the PR brought onto its target). Tooling/agent flows built over cherry-pick must carry the parent count (git log `%P`) and set mainline for merges."
context:
  tools: [claude-code, cursor, windsurf]
  languages: [bash, typescript]
  platforms: [git, github]
  tags: [git, cherry-pick, merge-commit, mainline, backport, tooling]
---

## Symptom

A cherry-pick that works for ordinary commits fails on exactly the commits
users most want to move around — merged PRs:

```
$ git cherry-pick 2a9c68d
error: commit 2a9c68d... is a merge but no -m option was given.
fatal: cherry-pick failed
```

If a panel, backport script, or agent flow wraps cherry-pick, the failure
surfaces as a cryptic error on 100% of merge-commit inputs — typically
discovered in review or production, because tests used ordinary commits.

## Why

A merge commit has two (or more) parents, so "the change this commit
introduces" is ambiguous — git needs to know which parent is the mainline to
diff against. `-m 1` selects the first parent, which for a PR merged into a
target branch means "everything the PR brought onto that branch" — the intent
users have when they pick a merged PR.

Squash-merges and rebase-merges produce single-parent commits and cherry-pick
without `-m` — which is why merge-commit handling is easy to miss when the
team's default is squash.

## The fix — in commands and in tooling

```bash
git cherry-pick -m 1 <merge-sha>
```

Tooling that offers commits as pick targets must know which ones are merges.
`git log` gives the parents for free:

```
git log --pretty=format:'%H %P'   # second field: space-separated parents
```

Carry `isMerge = parents.length > 1` in the tool's data model and branch on it:

```ts
const args = ["cherry-pick", ...(isMerge ? ["-m", "1"] : []), sha];
```

## Caveats

- A cherry-picked merge records **no merge relationship** — git will not know
  the original branch was "already merged" here. Later merging that branch can
  re-apply or conflict. For moving a whole feature, prefer merging the branch
  into the target worktree over cherry-picking its merge commit.
- `-m 2`+ (diff vs the merged-in side) is rarely what users mean; default to
  `-m 1` and make anything else explicit.
- Side gotcha when sorting the picked commits: `%cI` ISO timestamps carry
  per-committer UTC offsets (GitHub web merges vs local commits), so string
  comparison mis-orders them — compare `Date.parse()` values, not strings.

## When this does NOT apply

- **Squash-only workflows** — every landed commit is single-parent; plain
  cherry-pick works (but tooling should still handle merges defensively).
- **Reverting merges** — `git revert -m 1` has the same mainline mechanics but
  different follow-up semantics (re-merge needs the revert reverted).

## Related

- [[lsn_rebase_vs_merge_integration]] — choosing the integration style that
  produces (or avoids) merge commits in the first place.
- [[lsn_resolving_merge_conflicts_as_agent]] — resolving the conflicts a
  mainline cherry-pick can still produce; never blanket `--ours/--theirs`.

Surface this from a session with:

```js
search_lessons({ query: "cherry-pick merge commit -m mainline fails", platforms: ["git"] })
```
