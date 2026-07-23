---
id: lsn_verification_gate_gitignore_own_artifacts
title: "A verification gate that writes into the working tree it inspects poisons its own next run"
type: workflow_best_practice
tier: community
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: [git]
  tags: [ci, git, gitignore, idempotency, pre-merge-gate, working-tree]
summary: >
  A pre-merge / pre-commit gate that runs a tool which writes artifacts into the
  repository working tree, then reads working-tree cleanliness (or feeds a
  `dirty` flag into a downstream predicate), makes the tree dirty on its own
  first run — so the second run sees a dirty tree and the check becomes
  permanently unsatisfiable. Gitignore the tool's outputs so the gate can never
  observe them.
---

## The trap

A gate runs a verification tool, and that tool writes a report or cache into the
working tree:

```bash
my-review-tool --gate   # writes .reports/review.md + .reports/review.json
```

The gate (or something downstream of it) then reads the working tree's state —
directly (`git status --porcelain`) or transitively, because the tool records a
`dirty` flag about the tree it just ran in and feeds that into a verdict. If the
tool's own output files are **not** ignored:

1. Run 1 on a clean tree → tool writes `.reports/*` → tree is now dirty.
2. Run 2 → the tree is dirty (from run 1's output) → the cleanliness check fails,
   or the `dirty` flag flips the verdict.

From the second run onward the gate can **never** pass on the "clean" path, even
though nothing a human changed is dirty. The tool has poisoned the exact
property it was built to certify.

## Why it hides

- On a fresh checkout (CI's normal case) the tree starts clean and the **first**
  run passes — the bug is invisible in a green first CI run. It bites the second
  local run, or a CI job that reuses a workspace.
- The failing leg (`dirty`) is generic, so the failure reads as "you have
  uncommitted changes" — pointing at the developer, not at the tool that wrote
  the files.
- Typecheck / unit tests never catch it: the tool works, the artifacts are
  correct; the *interaction* between "writes to tree" and "reads tree state" is
  the defect.

Real-world shape: a merge gate's attestation step wrote `review.md` +
`review.json` into the tree, and its predicate included `dirty == false` (a clean
worktree is part of what "this verdict describes commit X" means). Un-ignored,
the first run measured `dirty = true` → the attestation degraded to non-grade
while every other leg (no stale files, full coverage, correct base) was perfect.

## Detect

```bash
# Run the gate twice on an otherwise-clean tree. If run 2 reports the tree dirty
# but you changed nothing, the gate is writing into its own inspected scope.
git status --porcelain     # confirm clean
<run the gate>
git status --porcelain     # anything the gate produced here is the leak
<run the gate again>       # does it now fail on "dirty" / "uncommitted"?
```

Any path emitted by the tool that shows up in `git status` is a poisoning
candidate.

## Fix

Take the tool's outputs out of the inspected scope — gitignore them — then prove
**idempotency**, not just correctness: run the gate twice with the first run's
artifacts left on disk, and assert the second run reaches the same clean verdict.

```gitignore
# Verification-tool artifacts — generated; must never dirty the tree the gate inspects
.reports/review.md
.reports/review.json
.reports/*.cache
```

The general rule: **a tool that inspects a resource must exclude its own outputs
from the inspected scope.** Whenever a check both *reads* working-tree state and
*runs a step that writes into the working tree*, the writes must land in ignored
paths (or outside the tree). It is the observer effect for build tooling —
measuring changed the thing measured. The same shape appears beyond git: a
formatter that writes a cache then asserts "no files changed"; a
`generate && git diff --exit-code` codegen check whose generator also writes an
un-ignored manifest; a coverage gate that writes `coverage.xml` into a tree it
then checks for cleanliness. Surface the cluster with:

```js
search_lessons({ query: "gate writes working tree dirty idempotent gitignore", tags: ["ci", "git"] })
```

## When this does NOT apply

- The tool writes only **outside** the repo (a temp dir, `$XDG_CACHE_HOME`, an
  artifact store). Nothing lands in the inspected tree → no poisoning.
- The gate never reads working-tree state — it only runs typecheck/tests and keys
  off exit codes. There is no tree-cleanliness property to poison.
- Fresh-checkout-only CI that never reuses a workspace AND never chains a second
  tree-reading step after the writing step. Fragile: the day someone caches the
  workspace or adds a second step, the bug appears — ignoring the artifacts is
  cheap insurance either way.

Related: [[lsn_docker_deploy_dirty_worktree_tag_gate]] is the inverse — a gate
that *under*-checks tree state (HEAD-is-tagged) and ships a dirty tree anyway;
here the gate *creates* the dirtiness it over-checks.
