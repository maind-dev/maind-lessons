---
id: lsn_worktree_picker_exclude_main_worktree
title: "Worktree-target pickers must exclude the MAIN worktree by identity — 'not the current one' is not enough"
type: workflow_best_practice
tier: community
summary: "Tooling that offers git worktrees as mutation targets (cherry-pick/merge/apply pickers in panels, scripts, agent flows) and filters only 'not the current root' offers the MAIN worktree as a target the moment the tool runs FROM a linked worktree. On a shared main tree (parallel sessions, live-deploy-on-push) that mutation is the catastrophic case. Exclude main by identity: `git worktree list --porcelain` lists it first (documented) — drop entry 0 in addition to the current root."
context:
  tools: [claude-code, cursor, windsurf]
  languages: [typescript, bash]
  platforms: [git]
  tags: [git, worktree, shared-worktree, parallel-sessions, tooling-safety, agent-safety]
---

## The trap

You build a "pick a worktree to apply this into" surface — a cherry-pick target
picker in an IDE panel, a backport script, an agent flow that remixes commits
between feature states. The obvious safety filter is:

```ts
const targets = allWorktrees.filter((w) => resolve(w.path) !== resolve(currentRoot));
```

This looks correct from the main tree: the main worktree IS the current root,
so only linked worktrees are offered. But `git worktree list` is symmetric —
run the same tool **from inside a linked worktree** (the advertised workflow!)
and `currentRoot` is now the linked worktree, so the **main worktree appears in
the target list** like any other entry. One click cherry-picks into the main
tree, mutating its index and files.

On a solo laptop that is an annoyance. On a shared main tree — parallel agent
sessions working in one checkout, or a branch that auto-deploys on push — it is
the exact mutation the whole worktree-isolation setup exists to prevent.

## The fix — exclude main by identity, not by position of the caller

`git worktree list --porcelain` lists the main worktree **first** (documented
behavior), which gives a stable identity check:

```ts
const all = parseWorktreeList(await git(["worktree", "list", "--porcelain"]));
const mainPath = all.length > 0 ? resolve(all[0].path) : null;
const targets = all.filter((w) => {
  const p = resolve(w.path);
  return p !== resolve(currentRoot) && p !== mainPath;
});
```

Both exclusions are needed: `currentRoot` (never offer "self") and `mainPath`
(never offer the primary tree, regardless of where the tool runs from).

## Verification

Run the picker twice: once from the main tree, once from a linked worktree.
In both runs the main worktree's path must be absent from the offered targets.
The second run is the one the naive filter fails.

## When this does NOT apply

- **Read-only surfaces** (listing worktrees, showing status) — no mutation,
  nothing to exclude.
- **`git worktree remove` pickers** — git itself refuses to remove the main
  working tree, so the failure is a clean error, not a silent mutation.
  Excluding main is still better UX, but not a safety requirement.
- **Single-worktree repos** — the picker is empty either way.

## Related

- [[lsn_parallel_sessions_first_ask]] — the session-start counterpart: treat
  unexpected shared-tree state as a peer's work.
- [[lsn_resolving_merge_conflicts_as_agent]] — what to do when the cherry-pick
  you routed into a proper worktree target hits conflicts.

Surface this from a session with:

```js
search_lessons({ query: "worktree picker mutation target exclude main worktree", tags: ["worktree"] })
```
