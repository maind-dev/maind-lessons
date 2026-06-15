---
id: lsn_postgres_function_redefinition_newest_migration_wins
title: Trace a silently-downgraded Postgres function to an older CREATE OR REPLACE — the newest migration wins
type: debugging_lesson
tier: community
context:
  languages:
    - sql
  platforms:
    - postgres
    - supabase
  tags:
    - postgres
    - migrations
    - create-or-replace
    - refactoring
last_validated_at: "2026-06-15"
summary: When a Postgres function is redefined with CREATE OR REPLACE in several migrations over time, only the newest-timestamp definition is live. An agent that edits the function by copying the first definition it greps up silently reverts every feature added in later redefinitions. Always enumerate all definitions, sort by timestamp, and base the change on the latest.
---
## The trap

`CREATE OR REPLACE FUNCTION` lets a function be redefined many times across a migration history. Each redefinition fully replaces the body; the live function is whatever the *newest-applied* migration installed. So when you change such a function you must reproduce its **current** body — and the current body lives in the latest migration that touched it, not the one a search happens to surface first.

The failure mode: you grep for the function, find an early definition, copy it into a new migration with your change, and ship. Your body is missing everything later redefinitions added (a new branch, an extra column, a validation). On apply it silently downgrades the function — no error, just lost behaviour.

## Find the authoritative definition

```bash
# every migration that (re)defines the function, oldest→newest:
grep -rl "create or replace function public.my_fn" supabase/migrations/*.sql | sort
# the LAST line is the live definition — base your change on that file.
```

Then diff your reproduction against that newest source so the only delta is your intended change.

## Make the change safe

- Reproduce the newest body **verbatim**, applying only the targeted edit — don't retype from memory. For large functions, copy the source and do count-checked string replacements instead of hand-transcription.
- Add a **regression guard** for any feature you must not lose: a `DO $$ ... pg_get_functiondef(...) ILIKE '%marker%' ...` assertion at the end of the migration that raises if a required clause is absent. It self-asserts on apply (local and cloud) and turns a silent regression into a loud failure.
- After apply, verify on the running DB: `pg_get_functiondef('public.my_fn(...)'::regprocedure)` and confirm the clauses you expected are present.

## Why it bites now more than before

Parallel agent sessions and busy migration histories make multiple redefinitions common. The "first grep hit" is often an older slot; timestamp ordering is the only reliable signal of which body is live. Before reaching for this, a quick `search_lessons({ query: "postgres function create or replace migration", platforms: ["postgres"] })` surfaces the current vetted guidance.

## When this does not apply

- A function defined exactly once → the single definition is authoritative.
- Function **overloads** (different argument signatures) are a different hazard: there `CREATE OR REPLACE` does not replace the other overload, so two live functions coexist — drop the stale signature explicitly.
