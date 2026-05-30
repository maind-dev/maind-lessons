---
id: lsn_supabase_migration_timestamp_collision_recovery
title: "Recover from SQLSTATE 23505 on schema_migrations_pkey: diff colliding files, then rename or repair"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: []
  languages: [sql]
  platforms: [supabase, postgres]
  tags: [supabase, migrations, timestamps, parallel-sessions, sqlstate-23505, recovery]
summary: "`supabase db push` aborts with SQLSTATE 23505 on `schema_migrations_pkey` when two local migration files share a timestamp; the CLI applied the alphabetically-first one in a prior push, the second collides on the UNIQUE version key. Recovery is a 3-branch diff: rename when content differs, `migration repair` when content is identical, plus idempotency guards if the previous file had non-idempotent side-effects (cron.schedule, seed INSERTs)."
problem: |
  A `db push --include-all` produces output like:
  ```
  Applying migration 20260528000001_my_feature.sql...
  Applying migration 20260602000003_reconcile_cron.sql...
  ERROR: duplicate key value violates unique constraint "schema_migrations_pkey" (SQLSTATE 23505)
  Key (version)=(20260602000003) already exists.
  At statement: 2
  INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)
  ```

  Two local files happen to share `20260602000003`. The CLI applied
  `20260602000003_OTHER_NAME.sql` alphabetically first in a prior session
  (its row sits in `schema_migrations`); pushing `20260602000003_reconcile_cron.sql`
  later tries to INSERT a second row with the same primary key.

  Cascading effect: every migration AFTER the failing one in this push run
  stays unapplied — the CLI stops at the first error. A later
  `db push --include-all` (after the fix) picks them up.
solution: |
  Three branches, decided by SQL-content diff between the colliding files:

  **Diagnostic 1-liner** (find all collision-slots in the local dir):

  ```bash
  cd <project>/supabase/migrations && \
    ls *.sql | awk '{ ts=substr($0,1,14); print ts }' | \
    sort | uniq -c | awk '$1 > 1'
  ```

  Output rows of form `   2 NNNNNNNNNNNNNN` mark a collision. Then per
  collision-slot, inspect both files: `ls <slot>*.sql` lists them, `diff`
  them or read the headers.

  **Branch A — content differs** (the common case for parallel-session
  authoring):

  ```bash
  # Find the next free slot in the SAME date for chronological continuity:
  ls <slot-date>*.sql
  # Pick a slot that doesn't collide. Rename the file that has NOT been
  # applied yet (typically the alphabetically-LATER one — the alphabetically-
  # first one is the one that already wrote a row in schema_migrations).
  git mv supabase/migrations/<old_collision>.sql supabase/migrations/<new_slot>.sql
  pnpm supabase db push --linked --include-all
  ```

  **Branch B — content identical** (genuine duplicate, two files express
  the same migration):

  ```bash
  # Delete one local copy (keep the alphabetically-first if both committed):
  git rm supabase/migrations/<dup_copy>.sql
  # Mark the slot as applied (cloud ledger already has the row from the
  # first-applied copy):
  pnpm supabase migration repair --status applied <slot> --linked
  ```
  See `lsn_supabase_migration_repair_verify_sql` — `repair` only writes
  the ledger; verify the actual DB state matches what the file would have
  done.

  **Branch C — content differs AND the previously-applied file had
  non-idempotent side-effects** (`cron.schedule`, seed INSERTs, extension
  setup): rename as in A, BUT wrap the new migration with idempotency
  guards before push:

  ```sql
  -- Idempotent cron-job (re-apply-safe):
  SELECT cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'my_job'
    AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'my_job');

  SELECT cron.schedule('my_job', '23 * * * *', $$ ... $$);
  ```

  Without this, the rename + push would re-fire `cron.schedule` and fail
  with a different duplicate (this time inside pg_cron, not in the
  migration ledger).
gotchas:
  - "The CLI shows the collision-target in the error (`Key (version)=(NNN)`), but does NOT show WHICH other file in the dir already used that slot. The 1-liner above is the fastest path to find it."
  - "Use `git mv` not plain `mv` — keeps the file's history attached to the new path, which matters for `git blame` and for sync-scripts that detect rename via similarity rather than treating it as delete-plus-add."
  - "Branch B's `migration repair --status applied` writes to the ledger only — it does NOT execute the SQL. If the original file was never actually run (just marked applied), you get a phantom migration. See `lsn_supabase_phantom_migrations` for detection."
  - "Date-segment of the rename matters: keep it in the SAME day if possible (`20260602000003` → `20260602000005`, not `20260602000003` → `20260606000001`). The migration's logical ordering should reflect its real chronology; jumping days makes future readers wonder if the migration was actually written then."
  - "After the rename + successful re-push, the unapplied migrations from later in the queue (everything BELOW the failing line in the original push output) get picked up by the next `db push --include-all`. No special re-trigger needed."
last_validated_at: "2026-05-28"
---

## When this fires

Any scenario that produces same-timestamp migrations:

- **Parallel agent sessions** (the growing common case) — two AI-coding-agent sessions running in different terminals against the same repo, both creating a migration in the same minute.
- **Multi-developer teams** without timestamp coordination — two devs writing migrations the same morning.
- **Long-feature-branch merges** — branch was based on an old main; in the meantime main got a migration in the same slot.
- **Sync-scripts that auto-commit** without timestamp dedup — local + remote both produce a migration with `now()` formatted to the same minute.

## When this does NOT apply

- The collision is in the LEDGER but no second local file exists — that's not collision-recovery, that's a phantom-migration scenario (`lsn_supabase_phantom_migrations`).
- The push fails with a different SQLSTATE (e.g. `42P07` for `relation already exists`) — that's an out-of-order failure, not a timestamp collision; see `lsn_supabase_migration_out_of_order_include_all`.
- The push fails with `42883` / `0A000` — semantic SQL errors, unrelated to timestamps.

## Verification after the recovery push

```sql
-- Both files should now have ledger rows with DIFFERENT versions:
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version IN ('<old_slot>', '<new_slot>')
ORDER BY version;

-- No orphan version remains:
SELECT version FROM supabase_migrations.schema_migrations
WHERE version NOT IN (
  SELECT regexp_replace(pg_ls_dir, '_.*', '')
  FROM pg_ls_dir('<migrations-dir>')
  WHERE pg_ls_dir ~ '^\d{14}_.*\.sql$'
);
-- 0 rows = ledger and filesystem in sync.
```

## Prevention going forward

Before writing any new migration, run the 1-liner from the solution
section to catch a same-day collision pre-push. `lsn_migration_timestamp_precheck`
covers the pre-push side; this convention covers the post-crash side. The
two together close the loop.

## Cross-references

- `lsn_migration_timestamp_precheck` — prevention: `ls` the date-slot BEFORE writing a new migration. Pre-push complement to this post-crash recipe.
- `lsn_supabase_migration_out_of_order_include_all` — when the failure is ordering, not naming. Different SQLSTATE.
- `lsn_supabase_migration_repair_verify_sql` — Branch B's `repair --status applied` only marks the ledger; the linked convention covers verifying actual DB state.
- `lsn_supabase_phantom_migrations` — the inverse failure (ledger says applied, DB has no objects). Diagnostic-adjacent to Branch B.

## Tool-use example for agents

When `db push` fails mid-stream with SQLSTATE 23505 on schema_migrations:

```
search_lessons({
  query: "supabase migration duplicate timestamp 23505 schema_migrations recovery",
  platforms: ["supabase"],
  tags: ["sqlstate-23505", "recovery"]
})
```

Then `get_lesson({id: "lsn_supabase_migration_timestamp_collision_recovery"})` for the full 3-branch decision tree before deciding rename vs repair.
