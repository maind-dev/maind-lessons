---
id: lsn_migration_slot_uniqueness_merge_gate
title: "Enforce migration-slot uniqueness at MERGE-time — local/authoring-time guards can't see sibling branches"
type: workflow_best_practice
tier: community
summary: "Timestamp-prefixed migrations (Supabase YYYYMMDDNNNNNN) are a distributed counter with no allocator: an authoring-time precheck and a local pre-commit guard both scan ONE working tree, so two parallel branches can claim the same slot against the same base, stay green, and collide only after both merge. Fix at merge-time — a CI check on the PR merge ref (base+PR together) that fails on duplicate prefixes, plus 'require branches up to date before merging' so the second racer must renumber first."
context:
  platforms: [supabase, postgres]
  languages: [sql, javascript]
  tags: [migrations, timestamps, parallel-sessions, ci, branch-protection, merge-race, supabase]
---

## The failure that keeps recurring

Migration tools name files with a monotonic timestamp prefix (`YYYYMMDDNNNNNN_*.sql`). The DB tracks applied migrations by that prefix (Supabase: `schema_migrations` PK on the 14-digit version). Two migrations sharing a prefix therefore collide: `db push` fails with SQLSTATE 23505, or — the dangerous variant — SILENTLY skips one, after which code expects a column/RPC that never applied.

The prefix is a **distributed counter with no central allocator**. When N branches (parallel AI-agent sessions, or a busy team) each pick "the next free slot" from the same base, two independently pick the same number. Individually every branch is correct; the duplicate only exists in the *union* on main.

## Why the obvious guards do NOT stop it

Both common defenses scan a single working tree, so neither can see a sibling branch's not-yet-merged migration:

- **Authoring-time precheck** (`ls` the date-slot before writing — see [[lsn_migration_timestamp_precheck]]): the slot genuinely IS free relative to your base at authoring time. The sibling hasn't merged yet.
- **Local pre-commit collision guard** (scan the migrations dir on disk for duplicate prefixes): in an isolated-worktree model each session has its own disk; the sibling's file isn't there. Even in a shared tree, if your migration was committed before the sibling's landed, your commit already passed.

Symptom of the gap: you keep writing *reactive hotfixes* that rename a collided migration (e.g. "resolve 000004 slot collision") instead of a *preventive gate*. A recurring rename-hotfix is the tell.

## The fix: check at the merge boundary

1. **CI job on the pull-request merge ref.** On `pull_request`, `actions/checkout` checks out PR-merged-into-base, so base + PR migrations sit on disk together — exactly the cross-branch state the local guard is blind to. Fail on any duplicate prefix. Give it its OWN workflow, path-filtered on `**/supabase/migrations/**`, so a pure-migration PR (which triggers no app CI) is still covered.

```js
// scripts/check-migration-slot-uniqueness.mjs — runs from repo root in CI
import { readdirSync, existsSync } from "node:fs";
const DIRS = ["app/supabase/migrations" /* , other packages */];
const SLOT = /^(\d{14})_.+\.sql$/;
let failed = false;
for (const dir of DIRS) {
  if (!existsSync(dir)) continue;
  const bySlot = new Map();
  for (const f of readdirSync(dir)) {
    const m = SLOT.exec(f); if (!m) continue;
    bySlot.set(m[1], [...(bySlot.get(m[1]) ?? []), f]);
  }
  for (const [slot, files] of bySlot) if (files.length > 1) {
    failed = true; console.error(`dup ${slot}:`, files);
  }
}
process.exit(failed ? 1 : 0);
```

2. **Require branches to be up to date before merging** (branch protection) or a **merge queue**, with the check marked required. This is load-bearing: the merge-ref check alone runs against whatever base existed when CI last ran. If two PRs are green simultaneously, both can still merge. Up-to-date-before-merge forces the SECOND PR to re-run against the base that already contains the first's migration → the check fails → the author renumbers before merge. The merge queue does the same by serializing and re-testing against the queued base.

## Alternative worth considering: kill the shared counter

The deeper root cause is the hand-picked same-day counter. Collision-free identifiers make independent clashes astronomically unlikely: a full timestamp to the second (`20260708T164512_*`), a ULID/random suffix, or embedding the PR number in the name. Bigger change (tooling + habit), but it removes the race instead of policing it. The CI gate is still worth having as a backstop.

## When this does NOT apply

- A single-writer repo (one dev, no parallel agents, short-lived branches) rarely hits it — the local guard suffices.
- The failure is *ordering*, not *naming* (your migration is older than remote head): that is `--include-all`, not a slot collision — see [[lsn_supabase_migration_out_of_order_include_all]].
- Recovery *after* a collision already landed (rename vs `migration repair`): see [[lsn_supabase_migration_timestamp_collision_recovery]].

## Cross-references

- [[lsn_migration_timestamp_precheck]] — authoring-time prevention (necessary, insufficient alone).
- [[lsn_supabase_migration_timestamp_collision_recovery]] — post-crash recovery (rename/repair).
- [[lsn_supabase_migration_out_of_order_include_all]] — the adjacent ordering failure and its `--include-all` fix.

Retrieve from a symptom: `search_lessons({ query: "migration slot collision parallel branches merge-time CI enforcement", platforms: ["supabase"] })`.
