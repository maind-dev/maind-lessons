---
id: lsn_filename_counter_namespace_merge_gate
title: "A counter in filenames (ADR-NNN, RFC-, 0001-) is a distributed counter with no allocator — gate it, don't document it"
type: workflow_best_practice
tier: community
summary: "A sequential number in filenames — ADR-248-*.md, 0001-use-postgres.md, migration slots — is a distributed counter with no allocator. Parallel agent sessions each read the directory, each see N as highest, each write N+1: both correct, and the duplicate exists only in the union on the default branch. Presence tooling hints, it does not allocate. Gate at push time against sibling branches AND sibling worktrees including uncommitted files."
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  languages: []
  tags:
    - parallel-sessions
    - merge-race
    - naming
    - adr
    - git-worktree
    - agent-orchestration
---

## The shape of the failure

A directory holds files carrying a sequential number: `ADR-248-*.md`,
`0001-use-postgres.md` (adr-tools), `RFC-12-*`, `20260729103000_*.sql`.
Picking the next number means reading the directory and adding one.

With two agent sessions working in parallel worktrees, both do exactly
that, both see `247` as the highest, both write `248`. **Neither session is
wrong.** The duplicate does not exist in either working tree — only in the
*union* on the default branch, where it surfaces at merge time as a
conflict in an index file, or (for migration slots) at push time as a
silently skipped migration.

Field data from one repo after this was first noticed: **eleven** live
duplicates. Nine historical ADR numbers, plus two in flight — one ADR
number claimed on an unmerged branch, and one migration slot claimed by an
**uncommitted** file in a sibling worktree.

## Why the obvious countermeasures do not work

- **Authoring-time check (`ls | tail`).** Correct in *both* colliding
  sessions. In a worktree-per-feature model the sibling branch is
  structurally invisible. This is the trap: the check passes honestly.
- **A convention ("check before you pick").** It appeals to a look that no
  session can reliably perform. If the look itself is blind, telling
  people to look harder changes nothing.
- **Presence / session-coordination tooling.** Tempting, and measurably
  insufficient. In the observed incident eight sessions were announced and
  visible — with *zero* path claims among them, because auto-claiming is
  usually opt-in and observed paths are private for good reasons. Presence
  answers "who is around"; it does not *allocate* a number.
- **A CI check on the PR merge ref.** Correct in principle, and the right
  layer where it runs. But it is absent exactly when it matters most: no
  branch protection on free/private plans, and a job that never starts
  (exhausted quota, broken runner) is not lenient — it is *missing*.

## The gate that works: push-time, four sources

Check what **this branch newly adds** against every place a number could
already be taken:

1. the default branch (settled truth)
2. all other local branches (siblings before their merge)
3. **all sibling worktrees, including uncommitted files**
4. your own working tree

Source 3 is the one that matters and the one every other layer misses: in
the observed incident the competing file was in *no pushed commit*.

```bash
# added by this branch, relative to the merge base
git diff --name-only --diff-filter=A "origin/$DEFAULT...HEAD" -- "$DIR"
git ls-files --others --exclude-standard -- "$DIR"   # uncommitted counts too
# taken elsewhere
git ls-tree -r --name-only "origin/$DEFAULT" -- "$DIR"
git for-each-ref --format='%(refname:short)' refs/heads   # then ls-tree each
git worktree list --porcelain                             # then readdir each
```

Two implementation details decide whether the gate is usable:

- **Deduplicate by distinct PATH, not by sighting.** In a workspace with a
  dozen worktrees the same file is seen a dozen times. Counting sightings
  reports every file as a collision.
- **Keep one counter per directory.** Two projects in a monorepo each own
  their own `ADR-100`; a global namespace turns 200 unrelated documents
  into noise.

## Detect namespaces instead of configuring them

Hardcoding `^ADR-` solves one instance and misses the next naming scheme.
Discover candidates instead: a directory where N+ tracked files share a
`^<prefix>[-_]?(\d{2,})[-_.]` shape is a namespace. Use `git ls-files` so
`.gitignore` is respected for free.

**The discriminator between a counter and a date is uniqueness, not a
prefix denylist.** `BRIEF-2026-07-27-notes.md` parses exactly like a
numbered file and yields `2026`; a year of such notes collapses onto a
handful of values, so a naive detector reports every second one as a
collision. A counter exists *in order to be* unique — require the group's
numbers to be, say, 80 % distinct and date families drop out on their own,
in any language and any naming scheme.

## Report "newly introduced" and "pre-existing" differently

The judgement is **"does this branch add the clash?"** — not "does a clash
exist":

| Situation | Verdict |
|---|---|
| this branch introduces a taken number | block |
| the clash predates this branch | inventory only |
| gaps in the sequence | say nothing — gaps are legitimate |

This replaces a hardcoded baseline/allowlist of known duplicates. An
allowlist is repo-specific, needs pruning after every cleanup, and is
worthless to anyone else; "did *you* add it?" needs no maintenance and
works on first run in any repo. And it matters practically: a gate that is
red from day one on a repo with historical duplicates gets bypassed, and a
bypassed gate protects nothing.

For the same reason, fail **closed** only on a detected collision and
**open** on infrastructure trouble (unresolvable default branch, broken
git, missing build of your own checker).

## When this does not apply

- **Single-writer repos.** One person, short-lived branches, no parallel
  agents: the authoring-time look is genuinely sufficient.
- **Collision-free identifiers.** ULIDs, UUIDs, full timestamps to the
  second, or PR-number-derived names remove the race instead of policing
  it. If you can still choose the scheme, choose that — the gate is for
  the counters you have inherited.
- **Numbers that need not be unique.** Image sequences, fixture indices,
  sharded data files. A detector will find them; treat their duplicates as
  inventory, never as blockers.
- **Recovering after a duplicate already merged.** That is a rename plus
  reference rewrite, a different job. Decide up front that already-merged
  references (commit messages, applied migrations) stay as history.
- **Young namespaces below the detection threshold.** A directory with
  three numbered files will not be recognised — knowingly the weakest spot,
  and precisely where a collision goes unnoticed longest. Lower the
  threshold explicitly for a series you care about.

Retrieve when about to create a numbered file, or before pushing a branch
that adds one:

```
search_lessons({ query: "numbered filename collision parallel sessions merge gate" })
```

Cross-refs: [[lsn_migration_slot_uniqueness_merge_gate]] — the same
mechanism for Supabase migration slots, where the consequence is harsher
(a duplicate slot fails `db push` or skips a migration silently). This
lesson generalises it to any filename counter; keep the domain-specific
guard where one exists, since it can phrase the consequence far better
than a generic one.
