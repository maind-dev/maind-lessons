---
id: lsn_reused_branch_name_stale_merged_pr
title: A reused branch name resolves to its OLD merged PR — verify PR state after pushing
type: workflow_best_practice
tier: community
summary: >-
  GitHub binds PRs to the head-branch NAME, and `gh pr view <branch>` returns the
  most-recent PR for that branch regardless of state — including a long-merged
  one. Tooling that checks "does a PR exist for this branch?" then finds the stale
  merged PR, skips creating a new one for your fresh commits, and a later merge
  step can act on the wrong PR. After pushing, verify the resolved PR is OPEN and
  its head SHA matches; prefer unique, never-reused branch names.
context:
  tools:
    - gh
    - git
  languages: []
  platforms:
    - github
  tags:
    - git
    - github
    - gh-cli
    - pull-request
    - branch-naming
    - workflow
    - verification
---

## Symptom

You push fresh work to `feat/<name>` and ask your PR tooling to open a PR — but
instead of a new PR you get "a PR already exists for this branch", pointing at a
PR you don't recognize. Or worse: the step is silent, no new PR appears, and a
later "merge the PR for this branch" action nearly merges — or does merge — a PR
that has nothing to do with your commits.

The tell: the PR the tool resolved is `MERGED` (or `CLOSED`), and its head commit
is an old SHA, not the one you just pushed.

## Mechanism

GitHub associates a pull request with its **head-branch name**, and that
association survives the merge. A merged PR keeps its head-branch name on record.
So when you delete a branch after merge and later create a *new* branch with the
**same name** for unrelated work, lookups keyed only on the name still find the
old, merged PR:

```bash
# `gh pr view <branch>` returns the MOST-RECENT PR for that head branch —
# it does NOT filter to open PRs. A long-merged PR resolves just fine:
gh pr view feat/my-thing --json number,state
# -> { "number": 73, "state": "MERGED" }   # stale! not your new work
```

Any script or workflow whose existence check is "does `gh pr view <branch>`
succeed?" cannot distinguish an **open** PR for the current work from an **old,
merged** PR that merely shares the branch name. It concludes "PR exists", skips
`gh pr create`, and your fresh commits get no PR. Downstream, a merge step that
also resolves by branch name will target that stale PR.

This is a specific instance of a broader trap — acting on state resolved by an
ambiguous key without checking the state actually matches your intent.

## How to apply

1. **Verify the resolved PR after every push — state AND identity, not just
   existence.** Existence is not enough; a merged PR "exists".

   ```bash
   gh pr view feat/<name> --json number,state,headRefOid,title
   # state == "MERGED" or "CLOSED"  => STALE, this is not your PR.
   # Cross-check the head SHA against what you actually pushed:
   git ls-remote origin feat/<name>            # remote branch tip
   # It must equal .headRefOid from the PR above.
   ```

2. **On a stale-name collision, create a fresh PR explicitly** rather than
   reusing the resolved one:

   ```bash
   gh pr create --base main --head feat/<name> --fill   # new PR number
   ```

   Then run any merge/promote step against the **new** PR number, never the one
   a name-only lookup returned.

3. **Prevent it: use unique, non-reused branch names.** If a name was ever used
   for a since-merged PR, pick a distinct one for new work
   (`feat/thing-landing` rather than reusing `feat/thing`). A branch name is
   cheap; a merge against the wrong PR is not.

4. **Harden the tooling: filter existence checks to open PRs.** Prefer
   `gh pr list --head feat/<name> --state open` (empty result => genuinely no
   open PR => create one) over a bare `gh pr view <branch>` that matches any
   state.

## When this does NOT apply

- **Branch names are always unique** (e.g. names include a ticket id or a
  timestamp, and are never recycled). Then a name never resolves to a prior PR.
- **You genuinely want to find the last PR for a branch regardless of state**
  (auditing history, "what shipped on this branch last time"). There, matching a
  merged PR is the correct behavior — this convention is about existence checks
  that gate PR *creation* or *merge*, where a merged match is a false positive.
- **Platforms that key PRs/MRs on an immutable id rather than the branch name**
  behave differently; the failure is specific to branch-name-keyed lookups.

## Related

- `[[lsn_verify_cli_side_effects_second_source]]` — the general discipline this
  is an instance of: after a CLI action, verify the real state via a second
  source; the summary line ("PR exists") is interpretation, the PR's `state` +
  `headRefOid` is ground truth.
- `[[lsn_gh_run_rerun_replays_old_state]]` — sibling "you're testing against
  stale, not current, state" trap in the same `gh`/GitHub family.

When PR tooling reports a branch collision or a merge step names a PR you don't
recognize, this convention is one search away:

```typescript
search_lessons({
  query: "reused branch name resolves to old merged PR verify state",
  tools: ["gh", "git"],
  platforms: ["github"],
});
```