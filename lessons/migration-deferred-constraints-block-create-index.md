---
id: lsn_migration_deferred_constraints_block_create_index
title: "Fix SQLSTATE 55006 `cannot CREATE INDEX ... pending trigger events` — and why a green re-run proves nothing"
type: debugging_lesson
tier: community
version: 1
last_validated_at: "2026-08-26"
summary: "A migration that cleans up existing rows and then creates an index fails with SQLSTATE 55006: the cleanup writes a column covered by a DEFERRABLE constraint, those checks queue until COMMIT, and CREATE INDEX refuses while the table has pending trigger events. Fix: `SET CONSTRAINTS ALL IMMEDIATE` between them. The deeper trap is verification — an idempotent re-run finds nothing to clean and stays green, and so does a fresh-database CI run: the trigger condition is data, not code."
context:
  tools:
    - supabase-cli
    - psql
  languages:
    - sql
  platforms:
    - postgres
    - supabase
  tags:
    - postgres
    - migrations
    - deferrable-constraints
    - sqlstate-55006
    - idempotency
    - verification
    - false-green
---

# Deferred constraint checks block CREATE INDEX in the same transaction

## Symptom

A migration runs clean locally, then fails on the first real deployment:

```
ERROR: cannot CREATE INDEX "your_table" because it has pending trigger events
       (SQLSTATE 55006)
At statement: 13
```

The statement it names is an ordinary `CREATE UNIQUE INDEX`. Nothing about it is
wrong, and running it by hand afterwards works.

## Mechanism

Three things line up inside one transaction:

1. Earlier in the migration you added (or the table already had) a **DEFERRABLE
   INITIALLY DEFERRED** constraint — very often a self-referencing FK, because a
   `BEFORE INSERT` trigger that writes `NEW.id` into a pointer column references
   a row that does not exist yet. An immediately-checked FK cannot work there.
2. A **backfill / cleanup block** then writes that column on existing rows.
   Every write queues a deferred check; they all sit in the table's pending
   trigger-event queue until `COMMIT`.
3. `CREATE INDEX` **refuses to run on a table with pending trigger events**. It
   is not about the index or the constraint being in conflict — Postgres simply
   will not build an index while row-level work on that table is still owed.

Note the ordering requirement that produced the collision: the cleanup *must*
precede the index (otherwise the duplicates it removes would violate it), and
the constraint *must* be deferrable (otherwise the trigger cannot work).

### The fix

Force the queued checks to run before the index. Every referenced row already
exists, so this is a formality that empties the queue:

```sql
-- after the cleanup block, before any CREATE INDEX on that table
SET CONSTRAINTS ALL IMMEDIATE;

CREATE UNIQUE INDEX IF NOT EXISTS one_live_per_scope
  ON public.your_table (scope_id, path)
  WHERE status = 'live';
```

`SET CONSTRAINTS` only has meaning inside a transaction, which a migration
already is. On any run where the cleanup finds nothing, the statement is a
no-op — which is exactly why it is easy to leave out and never notice.

## Why both of your safety nets miss this

**A second run of the same migration is structurally blind to it.** Migrations
are usually written idempotently (`IF NOT EXISTS`, `DROP ... IF EXISTS`,
`CREATE OR REPLACE`) so they can be re-applied safely. But the second run finds
**nothing left to clean** — the first run already did it — so nothing queues,
and `CREATE INDEX` sails past. If you edited the migration between the two runs
(adding the `DEFERRABLE`, say), the run that *would* have failed never happened
in that shape. A green re-run says: "this migration is idempotent." It does not
say: "this migration works."

**A fresh-database run in CI is blind to it too**, and this is the part people
get wrong. `supabase db reset`, a scratch container, a throwaway schema — the
table is *empty*, the cleanup block matches zero rows, nothing queues, green.
The trigger condition is **data, not code**. No amount of running the migration
chain against an empty database exercises the path that production takes.

That combination is what makes this class expensive: the two checks a team
trusts most both report success, and the first honest execution is the one
against the real database.

## How to verify a migration that touches existing rows

Reproduce the actual first run: a state **before** the migration that already
contains the rows it will act on.

```sql
-- 1. tear the migration's own artifacts back down (in one transaction),
--    and restore the rows it consumed
BEGIN;
DROP INDEX IF EXISTS public.one_live_per_scope;
DROP TRIGGER IF EXISTS trg_supersede ON public.your_table;
DROP FUNCTION IF EXISTS public.supersede();
UPDATE public.your_table SET status = 'live', pointer_col = NULL
 WHERE status = 'superseded';                 -- undo the cleanup's effect
ALTER TABLE public.your_table DROP CONSTRAINT IF EXISTS your_table_pointer_fkey;
ALTER TABLE public.your_table DROP COLUMN IF EXISTS pointer_col;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '<version>';
COMMIT;
```

```bash
# 2. confirm the pre-state really contains what the cleanup will act on —
#    a zero here means the rerun proves nothing
psql "$DB" -Atc "SELECT count(*) FROM (
  SELECT scope_id, path FROM your_table WHERE status='live'
   GROUP BY 1,2 HAVING count(*) > 1) x;"

# 3. run the UNMODIFIED migration → it must fail exactly as production did
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/migrations/<version>_*.sql

# 4. apply the fix, restore the same pre-state, run again → green
```

Step 2 and step 3 are the whole point. If you cannot make it fail first, you
have not reproduced anything, and step 4 proves nothing either.

Two habits that fall out of this: when a data-touching migration is written,
treat "did it run on a populated pre-state?" as a separate question from "did it
run"; and when a fix for some error class lands in the *test* file, immediately
check whether the production artifact carries the same hazard — in the incident
behind this entry, the identical `SET CONSTRAINTS` fix had already been written
into the assertion test hours earlier and was never carried back.

## When this does NOT apply

- **No deferrable constraint on the written column.** Immediately-checked
  constraints leave no queue; the index builds fine.
- **The write and the index are in different transactions.** Each `COMMIT`
  drains the queue. This is specifically a single-transaction hazard, which is
  what a migration file is.
- **`CREATE INDEX CONCURRENTLY`** cannot run inside a transaction block at all,
  so it never meets a pending queue — but it is also unavailable in a
  transactional migration for the same reason.
- **Pure-DDL migrations with no backfill.** No rows written, nothing queued.
  Only migrations that *touch existing data* have a first-run path that differs
  from a fresh-database path.

## Related

- [[lsn_gh_run_rerun_replays_old_state]] — the same false-green family from the
  other side: the re-run you trusted was not exercising the state you changed.
  There the replay is stale; here the replay is idempotent. Both hand you a
  green that means something narrower than you read into it.
- [[lsn_supabase_db_push_monorepo_cwd_ghost_dir]] — sibling migration trap where
  the tooling's own output reads as a legitimate diagnosis rather than as
  "the state you are testing is not the state that matters".
- [[lsn_multitenant_global_or_org_nullable_scope_partial_unique_rls]] — the
  partial-unique-index shape that commonly sits at the end of exactly this kind
  of cleanup-then-guarantee migration.

When a migration fails on deployment after a green local run, this vetted
convention is one search away:

```typescript
search_lessons({
  query: "cannot create index pending trigger events deferred constraint migration",
  platforms: ["postgres", "supabase"],
});
```
