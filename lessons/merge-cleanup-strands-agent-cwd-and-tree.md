---
id: lsn_merge_cleanup_strands_agent_cwd_and_tree
title: A promote script that deletes its own worktree strands the agent — dead cwd, and a main tree behind the merge
type: workflow_best_practice
tier: community
summary: Automation that squash-merges and then removes the feature worktree deletes the directory the agent process is standing in (a `cd` inside the invoked command does not protect it), and its best-effort fast-forward of the shared main tree can fail without a non-zero exit — after which `db push`, builds and codegen read a tree lacking the merged files and report success.
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  languages:
    - bash
  platforms:
    - git
    - supabase
  tags:
    - worktree
    - shared-worktree
    - agent-safety
    - silent-failure
    - post-merge
    - migrations
provenance:
  source: memory
  source_id: ffaef619-8e6e-43c0-980a-9c59cebbd6d6
  migrated_at: "2026-08-02"
---

A promote/merge helper that ends with "squash-merge, delete the branch, fast-forward
the main tree, remove the worktree" produces two failure modes in the same moment.
Neither exits non-zero, and the agent keeps working against a state that no longer
matches reality.

## 1. The script deletes the directory the agent is standing in

If the agent entered the worktree (a session-level directory change, an IDE "open
folder", a harness worktree mode) and then invokes the cleanup script, the script
removes that worktree — including the process's current working directory. Every
later child process dies with `ENOENT ... posix_spawn '/bin/sh'`. The shell is fine;
the inherited working directory is gone. Session-end hooks then fail *after* the
merge already landed, which reads like "the merge broke something".

**A `cd` inside the invoked command does not save you** — it changes the child
process, not the caller:

```bash
cd /main/repo && ./promote.sh my-feature   # child process only
```

The agent session stays in the worktree, and that is what gets deleted. The
distinction matters because such scripts are usually documented as "safe to run from
a worktree" — a claim about git refusing to check out one branch in two places, not
about the calling process. Only a session-level directory change, or never entering
the worktree, protects the caller.

**Second half, easy to miss:** a presence/coordination record announced against that
worktree's branch survives the deletion. Parallel-session dashboards then show a live
session on a branch and directory that no longer exist until the TTL expires
(commonly 30 minutes), and a human waiting to reassign that session cannot force it.

## 2. The fast-forward of the shared main tree can fail, and the next command lies

Careful cleanup scripts fast-forward the shared main checkout **best-effort** and
refuse to force when local uncommitted work is in the way. That is correct — but the
warning scrolls past among dozens of success lines, and the script still exits 0,
because the merge really did succeed. "On main" is now true of the *remote* and false
of the *local tree*, and `gh pr view` / `git log origin/main` answer only the first
of those two questions.

The damage lands in tools that read files from disk rather than git state:

- `supabase db push --linked` finds no new migration file and reports "up to date" —
  indistinguishable from a successful push.
- A build or test run passes against pre-merge code.
- A generated-types refresh regenerates from the schema the merge was meant to change.

## Verification

Bind the post-merge claim to the filesystem instead of to the merge status:

```bash
# Is the local tree actually at the merged commit?
git -C "$MAIN_TREE" fetch origin main --quiet
test "$(git -C "$MAIN_TREE" rev-list --count HEAD..origin/main)" -eq 0 \
  || echo "local tree is behind — do not push, build or generate yet"

# Does the artifact exist where the tool will look for it?
ls "$MAIN_TREE"/supabase/migrations/<expected-timestamp>_*.sql
```

If the fast-forward is blocked by a peer's uncommitted work in a shared tree, do not
stash everything, reset, or check it away. Move only the overlapping file aside:

```bash
git stash push -m "temp for ff" -- path/to/only/the/conflicting/file
git pull --ff-only origin main
git stash pop
```

Then prove nothing was lost: diff `git status --porcelain` against a snapshot taken
beforehand, and confirm pre-existing stash entries are untouched.

## Structural fix, not a reminder

Both failures are procedural rules that get followed on the first run and skipped on
the second — repeating a known procedure is the highest-drift moment, not the first
pass. The durable fixes remove the need to remember:

- For work that ends in a merge, **do not enter the worktree at all** — operate on it
  with absolute paths. Then the cleanup step cannot delete the caller's directory,
  regardless of what anyone remembers.
- End the coordination/presence session in the same step that leaves the branch,
  before either disappears.
- Make any post-merge instruction conditional on an `ls` of the expected file, so the
  advice cannot be issued while the tree is stale.

## When this does not apply

- **The script merges but does not remove the worktree.** Only failure mode 2 is in
  play; the caller's directory survives.
- **The agent never entered the worktree** (absolute-path operation, the recommended
  shape). Failure mode 1 is then structurally absent, not merely avoided.
- **Consumers that read git state rather than files** — `git show`, `git diff`, a CI
  job that clones fresh — are unaffected by a lagging local checkout. The trap is
  specific to tools reading the working tree: migration pushers, bundlers, codegen.
- **Single-developer checkouts with a clean tree.** The fast-forward rarely fails, but
  "merged on the remote ≠ present locally" still holds after any blocked pull.

## Related

- [[lsn_git_sync_diverged_master_rebase_autostash]] — the recovery when the local
  trunk is simultaneously ahead and behind.
- [[lsn_worktree_picker_exclude_main_worktree]] — the mutation-target counterpart of
  running tooling from inside a linked worktree.

Surface this from a session with:

```js
search_lessons({ query: "promote script deleted worktree cwd local tree behind merge", tags: ["worktree"] })
```
