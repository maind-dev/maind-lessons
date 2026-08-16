---
id: lsn_stale_branch_migration_reslot
title: "Reviving a stale PR that carries timestamped migrations: re-slot to fresh timestamps, not just resolve conflicts"
type: workflow_best_practice
tier: community
summary: "A months-old branch revived by cherry-pick or rebase brings its migration files along with their original timestamps — now in the applied ledger's past. Conflict resolution alone ships them out-of-order and, worse, can replay stale CREATE OR REPLACE bodies over functions that later migrations redefined. The rework recipe: verify no later migration touched the same objects, rename the files into fresh free slots, and update every reference to the old filenames (drift manifests, docs)."
context:
  tools: [claude-code, cursor, windsurf]
  languages: [sql]
  platforms: [supabase, postgres]
  tags: [migrations, stale-pr, rework, timestamps, supabase, cherry-pick]
---
## The trap: old timestamps travel with the rework

Reviving an old PR (cherry-pick onto a fresh branch, rebase, conflict-fix)
carries its `supabase/migrations/<old-timestamp>_*.sql` files along unchanged.
Meanwhile the ledger has weeks of newer applied migrations. Two independent
problems hide in that:

1. **Ordering**: the files sort before already-applied versions — `db push`
   refuses them without `--include-all`
   ([[lsn_supabase_migration_out_of_order_include_all]]), and applying them
   out of order is exactly the class of surprise that flag exists to make
   explicit.
2. **Staleness**: a migration written months ago may `CREATE OR REPLACE` a
   function that a *later* migration has since redefined. Replaying the old
   body now silently downgrades the function — the newest-wins trap from
   [[lsn_postgres_function_redefinition_newest_migration_wins]], entered
   through the back door.

## The rework recipe

Before shipping the revived branch:

```bash
# 1. Does any later migration redefine what the old migrations touch?
grep -n 'CREATE OR REPLACE FUNCTION' old_migration.sql   # collect object names
grep -rl "FUNCTION public.<name>" supabase/migrations/ | sort
# any hit AFTER the old timestamp → rebase the migration's body onto that
# newest definition, or drop your change into a fresh migration entirely.

# 2. Re-slot to fresh timestamps (check the slot is free across worktrees and
#    parallel sessions first — [[lsn_migration_timestamp_precheck]]):
git mv supabase/migrations/20260714092800_feature.sql \
       supabase/migrations/20260815160000_feature.sql

# 3. Update every reference to the old filename:
grep -rn '20260714092800' --include='*.sql' --include='*.json' --include='*.md' .
```

Step 3 is the one that gets skipped: drift-guard manifests, CI check configs
and docs that reference migrations **by filename** keep pointing at a file
that no longer exists — the guard then validates the wrong thing or fails
loudly at the worst moment.

## Verification

- `supabase migration list --linked` shows the re-slotted versions as the
  newest local entries, in order after everything applied.
- A repo-wide grep for the old timestamps returns zero hits.
- The push is a plain `db push` — needing `--include-all` after a re-slot
  means a slot was picked in the past by mistake.

## When this does NOT apply

- **The old migration was already applied somewhere** (it reached the cloud
  before the PR stalled): that is ledger territory, not a rename —
  [[lsn_supabase_migration_timestamp_collision_recovery]] and its phantom
  sibling cover it. Renaming an applied migration creates drift.
- **The revived branch is only days old** and nothing newer touched the same
  objects: re-slot is still cheap insurance, but the staleness check may
  genuinely be a no-op.
- **Migration systems without timestamp ordering** (sequential integers with a
  central allocator) fail differently — there the revived number collides
  instead of sorting early.

```
search_lessons({
  query: "old branch migrations timestamps rework out of order",
  platforms: ["supabase"],
  tags: ["migrations", "rework"]
})
```
