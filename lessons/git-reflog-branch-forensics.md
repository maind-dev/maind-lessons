---
id: lsn_git_reflog_branch_forensics
title: "git reflog --date=iso as branch-forensics: read HEAD-history before any cleanup decision"
type: workflow_best_practice
tier: community
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: []
  tags: [git, reflog, forensics, diagnostics, branch-archaeology]
summary: "`git reflog --date=iso` shows every HEAD movement (checkout, commit, reset, merge) with timestamps — the cheapest tool to reach for when a repo's state is unfamiliar. Before any branch-cleanup or destructive decision, run reflog to learn whether a branch/commit was created intentionally by a previous session, by an automated tool, or by mistake."
problem: |
  An agent (or a human) opens a repo and finds state they don't recognize:
  a branch they didn't create, a commit they didn't author, HEAD pointing
  somewhere unexpected. The reflex is to ask "where did this come from?"
  — and the next reflex is often "let me just clean it up." Cleanup
  before forensics destroys the very evidence needed to decide whether
  the state was intentional.

  This pattern especially hits solo developers running multiple AI-agent
  sessions over hours or days: each session can leave branches, stashes,
  or commits behind that the next session has no in-context memory of.
solution: |
  Make `git reflog --date=iso` the first command before any cleanup-or-
  diagnose decision on unfamiliar state. The reflog is a per-repo,
  per-clone log of every ref movement — it answers "when was this
  branch created, from where, by what action" in seconds.

  Three core commands:

  1. `git reflog --date=iso | head -20` — last 20 HEAD-movements with
     ISO timestamps. Reveals checkout-events, commit-events, reset/merge
     events with the action verb shown explicitly.
  2. `git reflog show <branch>` — branch-specific log. Useful when you
     want the history of a specific branch ref rather than HEAD.
  3. `git fsck --lost-found` — dangling commits and orphan objects.
     For when you need to recover a commit that's no longer referenced
     by any branch (e.g. after `branch -D`).

  Reading the output:

  - The action verb after the colon (`checkout`, `commit`, `reset`,
    `merge`, `cherry-pick`, `rebase`) tells you what happened.
  - The `from X to Y` clause on checkouts tells you the branch state
    when the checkout occurred.
  - The timestamp lets you correlate with other context (when was this
    AI-session? when did CI run? when did the user step away?).
gotchas:
  - "The reflog is local to your clone. It does NOT survive a fresh clone, and it's not synced to remote. If the question is 'what happened in this repo across machines', reflog only answers the local-clone slice."
  - "The default reflog retention is 90 days for reachable commits, 30 days for unreachable. Branch-forensics questions older than that may need git-fsck or a fresh look at the remote."
  - "Without `--date=iso`, the default `git reflog` shows relative times ('3 hours ago') which lose precision quickly. Always use `--date=iso` for forensic work — ISO timestamps correlate with everything else."
  - "When a reflog entry shows `checkout: moving from <X> to <new-branch>`, it means the branch was created from X at that moment. This is often the smoking gun for 'when did this branch come into existence'."
last_validated_at: "2026-05-28"
---

## When to reach for reflog

Before any of these decisions, run reflog first:

- "Should I delete this branch?" — see if it carries unique commits
- "Why does HEAD point here?" — see the last action that moved it
- "Where did this stash come from?" — `git stash list` plus reflog of the stash ref
- "Was this commit ever on a different branch?" — reflog show on candidate branches
- "When did the working tree last match upstream?" — reflog plus timestamps

The cost of running reflog is near-zero (no network, no state change,
no risk). The cost of skipping it is irreversible cleanup based on
incomplete information.

## Core commands

```bash
# 1. Recent HEAD movements with timestamps (the workhorse)
git reflog --date=iso | head -20

# 2. Branch-specific history (refs other than HEAD)
git reflog show <branch-name>

# 3. Orphan commits (after branch -D, after reset --hard, etc.)
git fsck --lost-found
```

## Reading a real reflog snippet

```
b676e068 HEAD@{2026-05-28 14:54:12 +0200}: commit: chore(release): ai-lessons-mcp@0.1.9
c0329ee4 HEAD@{2026-05-28 14:49:31 +0200}: checkout: moving from master to test/wiki-sync-release-flow
c0329ee4 HEAD@{2026-05-28 14:48:13 +0200}: commit: chore(sync): update 63 files
```

Reads as: at 14:48 a sync-commit was made on master; at 14:49 a new
branch `test/wiki-sync-release-flow` was created from that commit; at
14:54 a release-commit was made on the new branch. From this you can
reconstruct: the branch is fresh today, has one unique commit, and
master was at `c0329ee4` when the branch was cut. Cleanup decisions
become safe because the history is known.

## When NOT to skip reflog

The temptation to skip reflog is highest when the unfamiliar state
looks "obviously" wrong — e.g. a branch with a name you don't recognize,
or a HEAD position that seems random. Those are exactly the cases where
reflog matters most, because "obvious" is doing the inference work that
should be done by the data. The default is: reflog first, decide second.