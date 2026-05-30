---
id: lsn_supabase_phantom_migration_repair_reverted
title: "Fix phantom migrations in-band: `repair --status reverted` + `db push --include-all`"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: []
  languages: [sql]
  platforms: [supabase, postgres]
  tags: [supabase, migrations, ledger, phantom, repair]
summary: "When a Supabase migration ledger shows `applied` but the SQL never ran (phantom migration), the documented fix is `psql -f` out-of-band. There is an in-band alternative: `supabase migration repair --status reverted <timestamp> --linked` followed by `supabase db push --linked --include-all`. Stays inside the official CLI workflow, keeps the ledger consistent, and works when the original migration is idempotent (which Supabase-style migrations usually are)."
---

## Why an in-band alternative matters

`psql -f` works but lives outside the migration system. The ledger
keeps claiming the migration ran; the team's audit trail says
"applied 2026-06-02", with no signal that the apply was a no-op
weeks ago. Reasoning about the next push (`db reset`, region
migration, fresh local catchup) becomes harder because the
ledger lies in a way only the current operator knows about.

The in-band workflow rebuilds the ledger truthfully: the
re-applied migration shows its real apply timestamp, and any
subsequent `db reset` re-runs it cleanly.

## The workflow

```bash
# 1. Diagnosis: confirm phantom via SQL existence query
#    (information_schema.columns / to_regclass / pg_proc)
#    Do not skip — `migration list` cannot tell you the DDL never ran.

# 2. Reset the ledger entry for the phantom migration ONLY.
#    This is a metadata write, no DDL.
supabase migration repair --status reverted <timestamp> --linked

# 3. Confirm the Remote column is now empty for that row:
supabase migration list --linked | grep <timestamp>
#    Expected: <timestamp> |              | <date>

# 4. Re-push. `--include-all` is required because the phantom
#    migration's timestamp is now older than the last successfully
#    applied remote migration; the CLI's default out-of-order
#    guard blocks the push otherwise.
supabase db push --linked --include-all

# 5. Re-run the existence query from step 1 to confirm all
#    expected DDL objects now exist.
```

The `--include-all` flag is the documented opt-in for "I've
verified ordering doesn't matter for these migrations." Use it
deliberately, not reflexively. The default out-of-order guard
catches the case where parallel sessions wrote conflicting
migration timestamps. In a repair scenario you've already
validated that the phantom migration is order-independent (see
dependency check below), so the guard is in the way, not
protecting you.

## When this workflow applies

- Original migration is **idempotent** — uses `IF NOT EXISTS`,
  `DO $$ BEGIN IF NOT EXISTS ... END $$`, `CREATE OR REPLACE`,
  `ON CONFLICT DO NOTHING`. Supabase-style migrations almost
  always are.
- Only **one or few migrations are phantom**, not the whole tail.
  If many are phantom, the cause is likely something other than a
  transient apply failure (e.g. backup restore that nuked the
  ledger) and needs investigation before any repair.
- The phantom migration has **no cross-dependencies on
  later-applied migrations**. Quick check:
  `grep -lE "<tables-or-funcs-from-phantom>" supabase/migrations/<later>*.sql`
  If later migrations alter the phantom's objects, you need to
  re-think the order, not just re-apply.

## When NOT to use this workflow

- **Migration is not idempotent.** Re-applying will fail mid-way
  (e.g. `CREATE TABLE` without `IF NOT EXISTS` on a partially-
  applied state). Either edit the migration to be idempotent
  first, or fall back to `psql -f` with the SQL trimmed to only
  the missing parts.
- **Migration is fundamentally broken.** Don't repair-and-retry a
  migration whose SQL is wrong. Edit it, then push.
- **You don't have authority to mutate cloud history.** Some teams
  treat `migration repair` as a non-routine operation requiring
  sign-off. In that case, document the repair plan and get
  approval before step 2.

## Verification checklist

```sql
-- 1. The previously-missing objects now exist
SELECT
  to_regclass('public.<expected_table>')::text                          AS table_,
  (SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='<existing_table>'
      AND column_name='<expected_column>')                              AS column_,
  (SELECT proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='<expected_function>'
     AND p.pronargs = <expected_argc>)                                  AS func_;

-- 2. The migration is now applied in the ledger
SELECT version FROM supabase_migrations.schema_migrations
WHERE version = '<timestamp>';
```

If any row is null after step 5, the migration's idempotency
guards didn't cover something — investigate before declaring the
repair done.

## Related

The phantom-migration class is documented in `[[lsn_supabase_phantom_migrations]]`;
the `--include-all` flag in `[[lsn_supabase_migration_out_of_order_include_all]]`;
the limits of `migration repair --status applied` (the inverse
direction) in `[[lsn_supabase_migration_repair_verify_sql]]`. This
convention complements those three with the specific in-band
**reverted** workflow.