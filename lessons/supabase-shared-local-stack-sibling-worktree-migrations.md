---
id: lsn_supabase_shared_local_stack_sibling_worktree_migrations
title: "Diagnose LegacyMigrationMissingLocalError — a sibling worktree applied its migrations to the shared local Supabase"
type: debugging_lesson
tier: community
summary: Git worktrees each carry their own supabase/migrations/, but share ONE local Supabase. A sibling branch's applied migrations leave ledger rows with no file in your checkout, so `supabase migration up` refuses with "Remote migration versions not found" — correct cwd, nothing to fix there. The CLI's suggested `repair --status reverted` un-records a running session's work; `db pull --local` writes their WIP schema into your migrations dir. Apply the file with psql, then `repair --status applied`.
context:
  tools:
    - supabase-cli
    - claude-code
    - cursor
    - windsurf
  languages:
    - sql
    - bash
  platforms:
    - supabase
    - postgres
    - git
  tags:
    - supabase
    - migrations
    - worktree
    - parallel-sessions
    - local-development
    - destructive-operations
last_validated_at: "2026-08-19"
---

## The situation

You work in git worktrees — one per feature, the shape parallel agent sessions
push you toward. Each worktree is a full checkout with its own
`supabase/migrations/`. But `supabase start` binds to the **project**, not to
the checkout: every worktree of the same repo talks to the *same* local
Postgres container and therefore the same
`supabase_migrations.schema_migrations` ledger.

Session B, working on `feat/session-identity`, applies its three
work-in-progress migrations locally. You, in worktree A on `master`, then try
to pull in a migration that just landed on master:

```
$ supabase migration up
Connecting to local database...
{"code":"LegacyMigrationMissingLocalError",
 "message":"Remote migration versions not found in local migrations directory.",
 "suggestion":"try repairing the migration history table:
   supabase migration repair --local --status reverted 20260818230000 20260818230001 20260818230002
 And update local migrations to match remote database:
   supabase db pull --local"}
```

Your cwd is right, your checkout is up to date, your migration is genuinely
pending — and the command still refuses. `--include-all` does not help: it
relaxes *ordering*, and this is not an ordering problem. The CLI checks that
every ledger row has a corresponding file in the migrations directory it can
see, and B's three files exist only in B's worktree.

## Why both suggested remedies are wrong here

The suggestion is written for the case where the ledger is genuinely ahead of
the repository. Under shared-stack-plus-worktrees it does damage:

- **`migration repair --status reverted <B's versions>`** removes those rows
  from the ledger. It does **not** roll back the schema — B's tables,
  functions and grants stay in the database. You have made the ledger lie
  about a colleague's session, and their next `migration up` will try to
  re-apply migrations whose objects already exist.
- **`db pull --local`** writes the *current local schema* — including B's
  unmerged work-in-progress — into a new migration file in **your**
  migrations directory. Commit that by accident and B's half-finished branch
  ships through your PR.

Both are irreversible in the direction that matters: they modify shared state
on behalf of a session that is still running.

## The safe fix

Do by hand exactly the two things the tool would have done, and nothing else:

```bash
# 1. Apply the migration. --single-transaction so a failure leaves nothing half-applied.
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
     -f supabase/migrations/20260818203000_my_migration.sql

# 2. Record it in the ledger — via the CLI, not a hand-written INSERT.
supabase migration repair --local --status applied 20260818203000
```

`--status applied` only inserts the ledger row; it never runs SQL. That
division of labour is the whole point: step 1 is the schema change, step 2 is
the bookkeeping, and neither touches the sibling's rows.

Do not hand-write the `schema_migrations` INSERT. The obvious attempt to
populate its `statements` column with `pg_read_file()` fails on a hosted or
containerised Postgres (`permission denied for function pg_read_file`) — and
if you wrapped step 1 and step 2 in one transaction, that error rolls your
migration back too, leaving you convinced it was applied when it was not.

### Verifying it landed

```bash
# Every repo file now has a ledger row (empty output = nothing pending):
comm -23 <(ls supabase/migrations/*.sql | sed 's#.*/##; s/_.*//' | sort) \
         <(psql "$LOCAL_DB_URL" -tAc \
             "select version from supabase_migrations.schema_migrations order by version")
```

The reverse direction (ledger rows with no file) will still list the sibling's
versions — that is the expected steady state on a machine with a feature
branch in flight, not a defect to repair.

## The mental model worth keeping

**"Local equals cloud" is not the target state on a developer machine.** Exact
equality holds only immediately after `db reset` and only until the first
branch migration runs. The target is *local ⊇ trunk*: everything on the main
branch is applied, plus whatever the branches in flight have added. Any tool
or habit that tries to force exact equality — a reset, a repair sweep — will
step on a parallel session's state.

If you truly need parity (reproducing a cloud-only bug), `db reset` from trunk
gives it, but it drops the sibling's migrations from the database. Their files
survive in their worktree, so they can re-apply — but that is their decision
to make, not yours to make for them. Coordinate first.

## When this does NOT apply

- **One checkout, no worktrees.** The ledger cannot contain a file you do not
  have; if it does, that is real drift and the CLI's advice may apply.
- **The `Local` column of `supabase migration list` is completely empty.**
  That is the cwd/ghost-directory failure, not this one — see
  [[lsn_supabase_db_push_monorepo_cwd_ghost_dir]], same error message,
  different cause and different fix.
- **The refusal comes from `db push --linked`** (the remote ledger, not the
  local one): a remote row without a local file is genuine drift between
  cloud and repository and needs investigating, not repairing away.
- **Ordering complaints** (`your migration is older than the remote head`) —
  that is `--include-all` territory, a different failure.

## Related

- [[lsn_supabase_db_push_monorepo_cwd_ghost_dir]] — identical error message
  from a wrong cwd; also documents why `--status reverted` is destructive.
- [[lsn_supabase_migration_repair_verify_sql]] — `repair` moves the ledger,
  never the schema; verify both sides afterwards.
- [[lsn_merge_cleanup_strands_agent_cwd_and_tree]] — the neighbouring
  worktree hazard: a promote that deletes its own worktree leaves the caller
  in a dead directory and the shared tree behind the merge.

```js
search_lessons({
  query: "supabase migration up refuses sibling worktree shared local database ledger",
  platforms: ["supabase"],
});
```
