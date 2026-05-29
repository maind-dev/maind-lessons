---
id: lsn_supabase_db_push_monorepo_cwd_ghost_dir
title: "Diagnose 'Remote migration versions not found' in monorepos — `migration repair --status reverted` is destructive"
type: debugging_lesson
tier: community
summary: "Two `supabase/` dirs in a monorepo (workspace-root + project-local): `supabase db push --linked` from the wrong cwd scans an empty `./supabase/migrations/` and reports every remote migration as 'not found'. The suggested `migration repair --status reverted <list>` DELETEs those rows from `schema_migrations` — next push re-applies every migration → `already exists` cascade. Fix: cd into the project-local supabase dir before pushing."
context:
  tools:
    - supabase-cli
  languages:
    - sql
  platforms:
    - supabase
    - postgres
  tags:
    - supabase
    - migrations
    - monorepo
    - cli
    - cwd-drift
    - destructive-operations
last_validated_at: "2026-05-18"
---

## Background

The Supabase CLI resolves `supabase/migrations/` relative to the current
working directory, not relative to where `supabase init` was originally
run. In a monorepo where each app keeps its own `supabase/` (each with
its own `.temp/linked-project` + `migrations/`), it is easy to end up
with a second, ghost `supabase/` at the workspace-root that only
contains `.temp/` (created by an earlier `supabase link` run from the
wrong directory). The ghost dir has no `migrations/` folder.

Run `supabase db push --linked` from the workspace-root and the CLI
sees zero local migration files but a fully-populated remote ledger.
Its diagnostic looks plausible:

```
Remote migration versions not found in local migrations directory.
Make sure your local git repository is up-to-date. If the error
persists, try repairing the migration history table:
supabase migration repair --status reverted 20251101120000 20251103090000 …
```

The suggestion is the trap. The files exist — they live in the
project-local `supabase/migrations/`. The CLI doesn't know that;
it only knows its own cwd.

## Why the suggested repair is destructive

`supabase migration repair --status reverted <version>` does **not**
roll back the schema. It DELETEs the matching row from
`supabase_migrations.schema_migrations` (the ledger). Run it over the
full list the CLI just printed and you have wiped the remote ledger
clean while the actual schema objects remain.

The next `supabase db push` then walks every local migration file
(once you finally `cd` to the right place) and tries to re-apply all
of them from scratch, hitting `CREATE TABLE ... already exists` /
`42P07` / `42710` / `42704` cascades on the first object that hasn't
been written with `IF NOT EXISTS`. Migrations halfway through a long
history are not idempotent; that's not a bug, that's the contract.

Recovery from a wiped ledger is painful: either re-write every
migration as idempotent, or repair the ledger entry-by-entry with
`--status applied` for each row that the schema already contains.
Both require careful comparison of the on-disk file list against the
actually-existing remote objects.

## Smoking-gun diagnosis and fix

Do this BEFORE running the CLI's suggested repair:

```bash
supabase migration list --linked
```

If the `Local` column is **completely empty** while the `Remote`
column has dozens of rows, the CLI did not find your local migration
directory at all. This is a cwd problem, **not** a drift problem. Do
not run `migration repair --status reverted`.

```bash
# Where am I, and what does THIS cwd's supabase dir actually contain?
pwd
ls -la supabase/
ls supabase/migrations/ 2>/dev/null | wc -l

# Find the real supabase dir(s) in the repo:
find . -type d -name migrations -path '*/supabase/migrations' -not -path '*/node_modules/*'
```

If `ls supabase/migrations/` errors with `No such file or directory`
or returns `0`, you are in a ghost dir. The `find` match with a
non-zero file count is where you need to be.

```bash
cd path/to/<app>/   # the one whose `supabase/migrations/` has the files
supabase db push --linked
```

Then clean up the ghost dir at the workspace-root, but only after
verifying that it really only contains `.temp/` artifacts and no
config, migrations, seeds, or functions:

```bash
ls -la supabase/   # at workspace-root
# expected: only .temp/ and maybe an outdated .gitignore
rm -rf supabase/   # only after that check
```

If the ghost dir does contain a `config.toml` or anything beyond
`.temp/`, treat that as a second linked project — investigate, don't
delete.

## Prevention

- Pin a shell-alias / npm-script that hardcodes the project path:
  `"db:push": "cd path/to/<app> && supabase db push --linked"`.
  Saves you from cwd-drift after every `cd ..` during a session.
- Make `supabase db push --linked` refuse to run from a directory
  whose `supabase/migrations/` is empty: a one-line wrapper that
  checks `[ -d supabase/migrations ] && [ "$(ls supabase/migrations 2>/dev/null | wc -l)" -gt 0 ]`
  before forwarding to the real CLI.
- Treat the CLI's `--status reverted` suggestion as advisory, not
  prescriptive. The CLI has cwd, you have intent — verify intent
  matches reality before running anything destructive.

## When this does NOT apply

If `supabase migration list --linked` shows entries in BOTH the
`Local` and `Remote` columns and the mismatch is on a small subset
of rows, you have a real drift situation — not a cwd issue. The
CLI's suggestions may genuinely apply there, but the verification
pattern from [[lsn_supabase_migration_repair_verify_sql]] still
holds: `repair` only touches the ledger, never the schema. Verify
both sides match expectations before and after.

This convention also does not apply to single-package repos with
exactly one `supabase/` at the project root — there is no second dir
to be in the wrong one of. The trap is specifically a monorepo +
accidental `supabase link` from the wrong cwd combination.

## Related vetted conventions

Same shape as [[lsn_npx_tsc_cwd_fallback]] and
[[lsn_0004_npx_tsc_wrong_cwd_silent_zero_errors]] — a CLI tool
silently does the wrong thing because cwd doesn't match the project
root, and the failure mode looks like a legitimate diagnostic
instead of "you're in the wrong directory."

Same destructive-CLI-suggestion shape as
[[lsn_supabase_db_remote_commit_destructive]] (the CLI offers a
command that does more than the verb in its name implies) and
[[lsn_supabase_migration_repair_verify_sql]] (`migration repair`
operates on the ledger only, not on the schema — both directions of
ledger-vs-schema drift bite here).

Search-suggestion to surface this and the related cluster:

```
search_lessons({
  query: "supabase migration repair reverted destructive monorepo cwd",
  platforms: ["supabase"],
  limit: 5
})
```
