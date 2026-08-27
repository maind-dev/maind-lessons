---
id: lsn_pr_number_ambiguous_across_sibling_repos
title: "Fix a `gh` command that answers from the wrong repo — PR numbers are per-repo counters resolved from cwd"
type: workflow_best_practice
tier: community
version: 1
last_validated_at: "2026-08-26"
summary: "`gh` resolves the target repo from the ambient cwd, and PR/issue numbers are per-repo counters. Where several checkouts sit under one tree — especially after a repo split, where the new repo's counter walks up through a range the old one already occupied — a bare number silently answers from a different repo. Nothing errors; the only tell is a branch, title, or state you do not recognise. Pass `--repo <owner>/<name>` or a full URL."
context:
  tools:
    - gh
    - git
  languages: []
  platforms:
    - github
  tags:
    - gh-cli
    - github
    - monorepo
    - repo-split
    - cwd-drift
    - pull-request
    - verification
---

# PR numbers are ambiguous across sibling checkouts

## Symptom

You ask about a pull request by number and get an answer that is *almost* right:

```
$ gh pr checks 149 --required
no required checks reported on the 'feat/plan-tier-normalize' branch
```

You never pushed a branch by that name. The command did not fail, did not warn,
and returned in the normal shape. If you are skimming — mid-merge, waiting on
CI — this reads as "checks aren't reporting yet", and you wait, or worse, you
proceed.

## Mechanism

Three independent facts combine:

1. **`gh` has no concept of "the repo I have been working in".** It resolves the
   target from the git remote of the **ambient cwd**. Change directory, change
   repo — silently.
2. **PR and issue numbers are per-repo counters.** `#149` is not an identifier;
   it is an offset into whichever counter you happen to be addressing.
3. **The enclosing directory is often itself a repo.** Nested checkouts under a
   workspace that is also version-controlled means cwd drift upward does not
   leave git territory — it lands you in a *different* repo, where the number
   resolves cleanly.

Fact 3 is what removes the safety net. If the parent directory were not a repo,
`gh` would fail with "not a git repository" — a loud, correct error. Instead it
answers.

### Why a repo split makes this acute

Splitting a repo restarts the new repo's PR counter at 1. It then walks up
through a range the old repo occupied long ago, so **every number below the old
repo's high-water mark has a doppelgänger.** The overlap is not an edge case
during that period; it is every PR you open.

The counter-intuitive part is worth stating plainly: **exposure is highest for
the YOUNGEST repo, not the busiest.** A repo with a handful of PRs has its
*entire* history inside every sibling's range. Exposure shrinks only as its
counter climbs past the oldest sibling's — years, not weeks. Treating a new repo
as the safe case inverts the truth.

Worse, the colliding PR is often **merged**, because the old repo's low numbers
are its oldest work. A merged doppelgänger reads as settled, not as wrong.

## How to check your exposure

Do not memorise the numbers — they move weekly. Measure when it matters:

```bash
# highest PR number per repo; any number at or below another repo's
# result is ambiguous between the two
for r in owner/repo-a owner/repo-b; do
  printf '%-24s %s\n' "$r" \
    "$(gh pr list --repo "$r" --state all --limit 1 --json number --jq '.[0].number')"
done

# which repo does this directory actually address?
git remote get-url origin
```

## How to apply

1. **Identify by repo, not by number alone.** `gh pr view 149 --repo owner/name`,
   or paste the full URL. A URL carries its own repo and cannot be misresolved.
   In CI, `GH_REPO` / `GITHUB_REPOSITORY` already pins it.
2. **Anchor cwd deliberately when a procedure moves you.** Worktree-based flows
   often *require* leaving the worktree (a promote step that deletes its own
   cwd, for instance). Land in the **main checkout of the same repo**, never the
   workspace root — that is the colliding one by construction.
3. **A branch name is not a substitute.** Branch names collide across repos too;
   they are merely less likely to. What must be explicit is the repo.
4. **Treat an unrecognised branch, title, or state as the alarm.** It is the only
   signal this failure produces. Before acting, re-run with `--repo` and compare.

For tooling that shells out to `gh`, pin both: pass an explicit `cwd` **and**
`--repo`. Pinning cwd alone is correct until the day cwd resolution changes.

## When this does NOT apply

- **The identifier already carries its repo** — a full URL, an explicit
  `--repo`, or a pinned environment. That is the compliant form, not a finding.
- **Commands that are not repo-scoped**: `gh auth status`, `gh api /user`,
  `gh repo list <org>` resolve nothing from cwd.
- **A checkout with no siblings under its tree.** The ambiguity genuinely does
  not exist — though a repo acquires siblings without announcing it.
- **Deliberately addressing another repo.** The rule is not "stay in your repo",
  it is "say which repo".

## Related

- [[lsn_reused_branch_name_stale_merged_pr]] — the same class one axis over:
  state resolved by an ambiguous key and acted on without checking the resolved
  thing matches the intent. There the ambiguous key is the branch name; here it
  is a number plus an implicit repo. Both frequently resolve to a *merged* PR,
  which is why both look settled rather than wrong.
- [[lsn_supabase_db_push_monorepo_cwd_ghost_dir]] — cwd drift whose failure mode
  is a plausible diagnostic instead of "you are in the wrong directory".

When a `gh` answer names something you do not recognise, this vetted convention
is one search away:

```typescript
search_lessons({
  query: "gh pr number wrong repo cwd nested checkouts repo split",
  tools: ["gh", "git"],
  platforms: ["github"],
});
```
