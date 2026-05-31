---
id: lsn_verify_cli_side_effects_second_source
title: "Verify CLI side-effects via second source — summary messages can lie"
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools: []
  languages: []
  platforms: []
  tags: [cli, verification, silent-failure, idempotency, ground-truth]
summary: "CLI summary messages ('up to date', 'already exists', 'no changes') are tool-side interpretations that can lag, cache, or have version-specific bugs. After any irreversible CLI action, verify via second source: --debug wire-protocol output, separate read-only command, or direct server query. Instance: older Supabase CLI says 'Remote database is up to date' after a push that actually applied migrations."
---

## Symptom

You run a CLI command that should mutate server-state. The summary message implies nothing happened ("up to date", "no changes", "already published"). You believe the message and either repeat the command, plan a workaround, or move on assuming the action is pending — until something later breaks because the action **actually did** happen (or didn't, depending which direction the message lies).

Real-world instance, 2026-05-30, Supabase CLI pre-v2.102.0:

```bash
$ supabase db push --linked --include-all
Connecting to remote database...
Remote database is up to date.       ← LIES — push actually applied a migration

$ supabase db push --linked --include-all --dry-run
Would push these migrations:
 • 20260606000003_<file>.sql          ← second source disagrees

$ supabase db push --linked --include-all --debug
... PG Send: BEGIN ...
... PG Recv: CommandComplete CREATE FUNCTION   ← wire-protocol confirms the push happened
... PG Recv: CommandComplete COMMIT
... PG Recv: CommandComplete "INSERT 0 1"      ← ledger updated too
Finished supabase db push.
```

The summary message and the wire-protocol disagree. The wire-protocol wins.

## Why summary messages lie

| Cause | Example |
|---|---|
| Version-specific output-formatting bug | Supabase CLI pre-v2.102.0 misreports out-of-order push as "up to date" |
| Cached state from an earlier command | `npm publish` thinks the version exists because of stale registry-metadata cache |
| Async server-state lag | `gh pr merge` returns "merged" before the branch-delete propagates |
| Idempotent-success conflation | `docker push` says "Layer already exists" — but did the manifest update? |
| Optimistic local state | `git push` succeeds locally then network-fails; status shows local view |
| Default truncation/suppression | `kubectl apply` reports "unchanged" for resources with server-side defaults the diff missed |

Each is a different mechanism, same effect: the CLI's natural-language summary is a thin layer over server-state that the CLI is willing to lie about (or be uncertain about) in ways that the underlying protocol exchange is not.

## Verification recipe

Three independent verification paths, in order of effort:

1. **Second CLI command that queries from a different code-path.**
   `supabase db push` (mutation) ↔ `supabase migration list --linked` (read). If they disagree, the read wins.
2. **Wire-protocol or debug output.**
   `--debug`, `--verbose`, or `-v` typically dumps the raw protocol exchange. `BEGIN` / `COMMIT` / `INSERT` / `404` / `201` are ground-truth; the summary line is interpretation.
3. **Direct server-state query.**
   SQL Editor, API GET, dashboard UI, `gh api ...`. Bypasses the CLI's interpretation layer entirely.

Use (3) when the CLI is fundamentally untrusted for that action; use (1) for routine paranoia; use (2) when (1) is ambiguous.

## When this workflow applies

- After any **irreversible or critical** CLI action (deploy, migration, publish, merge, delete, transfer).
- When the CLI's summary message is **suspiciously idempotent-sounding** ("up to date", "no changes", "already exists", "nothing to do") for an operation you expected to be a no-op only by coincidence.
- After CLI tool updates — version-specific output bugs are common, especially in CLIs that wrap multi-step server flows.

## When NOT to use this workflow

- **Truly read-only CLI commands** (`git log`, `gh issue list`) — there's nothing to verify; the read IS the answer.
- **Local-only side-effects** (`git add`, `npm install` of pure local deps) — file-system state is fast to inspect via `ls`/`git status`, no second source needed.
- **High-frequency loops where the verification cost exceeds the action cost** — for batch operations, verify the aggregate state (`COUNT(*) = expected`) once, not every iteration.

## Related conventions

- `[[lsn_supabase_phantom_migrations]]` — companion case: ledger says **applied**, table doesn't exist (phantom-applied). This convention covers the inverse: ledger says **nothing to push**, table actually exists (phantom-no-op).
- `[[lsn_supabase_migration_repair_verify_sql]]` — same-stack rule for the `migration repair` command's silent-on-action behavior.
- `[[lsn_surface_silent_errors_first]]` — broader silent-failure-family discipline.
- `[[lsn_supabase_gen_types_stderr]]` — different CLI-trust failure (stderr leaks into stdout). Same convention family.

When an agent sees a CLI report a suspicious no-op for a critical mutation, the convention is one search away:

```typescript
search_lessons({
  query: "verify cli side effects second source summary",
  tags: ["cli", "verification", "silent-failure"],
});
// → returns this convention with the 3-path verification recipe.
```