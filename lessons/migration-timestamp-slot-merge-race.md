---
id: lsn_migration_timestamp_slot_merge_race
title: "Diagnose a silently-skipped migration from a same-timestamp-slot merge race across parallel branches"
type: debugging_lesson
tier: community
context:
  tools: [claude-code, cursor, windsurf]
  languages: [sql]
  platforms: [supabase, postgres]
  tags: [migrations, timestamp-collision, parallel-sessions, merge-race, ci]
summary: "Two parallel branches each add a migration and pick the same timestamp-prefix slot (e.g. 20260708000001_*). A local pre-commit guard can't catch it — neither branch has the other's file at commit time; the clash only appears on main after both merge. Supabase-style ledgers key on the prefix, so the next push silently skips one migration, no error. Fix: second-precision timestamps plus a CI check on the merge result."
---

## When to reach for this

- A migration's schema (a table, column, or RPC) is missing in a shared/remote DB even though the file is on `main` and `db push` reported success.
- Two migration files on `main` share the same timestamp prefix.

```
search_lessons({ query: "migration silently skipped duplicate timestamp prefix parallel branches", platforms: ["supabase"] })
```

## The failure mode

A team runs many parallel sessions/branches against one shared `main`. Two of them each add a migration and both pick the day's "next" slot with a zero-padded counter — `20260708000001_feature_a.sql` and `20260708000001_feature_b.sql`. Each branch's **pre-commit** collision guard scans the local `migrations/` folder and sees no conflict, because the *other* branch's file does not exist on its disk yet. Both pass, both merge. Now `main` has two files sharing the prefix `20260708000001`.

Supabase's `schema_migrations` ledger keys on the **timestamp prefix**, not the full filename. On the next `supabase db push`:

- the first same-prefix migration applies and the ledger records version `20260708000001`;
- the second file — different name, same prefix — is treated as **already applied** and **silently skipped**. Its `CREATE TABLE` / `ALTER` / RPCs never run. No error is printed. The app then fails later with `relation ... does not exist` or a missing RPC, far from the real cause.

This is a *merge-race*, distinct from the single-session "I picked a taken slot" case that a pre-authoring precheck handles (see [[lsn_migration_timestamp_precheck]]). A pre-commit hook that greps the on-disk `migrations/` folder only sees the committing machine's working tree; a sibling branch's not-yet-merged migration is invisible to it. The collision is a property of the **merge result**, so it must be checked where the merge result exists — a local guard is structurally insufficient here.

## Fix and defenses (layered)

1. **Collision-resistant slots by construction.** Author migrations with a **second-precision** timestamp `YYYYMMDDHHMMSS_*`, not `YYYYMMDD00000N_*`. Two independent sessions almost never pick the same second, so the race nearly vanishes with zero coordination. This is the cheapest, highest-leverage change.

2. **CI / pre-merge check against the merge result.** Add a CI job that scans `migrations/` for duplicate timestamp prefixes and fails the PR. Combine with branch protection "require branches to be up to date before merging": after PR-A merges, PR-B must rebase onto the new `main`, its CI re-runs against A's migration, and the collision is caught **before** the second merge. This closes the exact gap a local hook cannot.

3. **Cross-session coordination (advisory).** In multi-agent/multi-session setups, announce presence and claim the `migrations/` path before authoring so parallel sessions can see each other's intent. Advisory, not a hard guarantee (a peer not using the coordination layer can still collide), so keep 1 + 2 as the real defense.

## Recovering an already-merged collision

If both files are already on `main` but nothing has been pushed to the remote DB yet, **rename one** to a free slot (content unchanged) and update its self-references — safe because no ledger row exists yet (details in [[lsn_supabase_migration_timestamp_collision_recovery]]). If the collided migration was **already applied** to a shared DB, do NOT rename it there; that creates ledger drift / phantom migrations ([[lsn_supabase_phantom_migrations]]) — add a new forward migration instead.

## Verification

```bash
# duplicate timestamp prefixes in the migrations dir (run in CI on the merge result):
ls migrations/ | sed -E 's/^([0-9]+)_.*/\1/' | sort | uniq -d
# any output = a collision that will silently skip a migration on push.
```

## When this does not apply

- Single-developer repos or strictly serialized migration authoring — the race can't occur.
- Migration tools that version by **full filename or content hash** rather than a timestamp prefix — those don't silently skip a same-prefix sibling (verify your tool's ledger key before relying on this).
