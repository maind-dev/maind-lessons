---
id: lsn_postgrest_embed_fk_disambiguation
title: "Fix PostgREST PGRST201 'more than one relationship' with `!<column>` embed-disambiguator"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: []
  languages: [typescript, sql]
  platforms: [supabase, postgres]
  tags: [postgrest, embedding, foreign-key, disambiguation, supabase-js]
summary: "When a table has TWO (or more) foreign keys to the same target table — e.g., `requester_user_id` and `decided_by` both referencing `public.users` — naive PostgREST embeds like `users(display_name)` fail with PGRST201 'more than one relationship was found'. Disambiguate by hinting the source column or the FK constraint name: `users!requester_user_id(display_name)` or `users!org_join_requests_requester_user_id_fkey(display_name)`."
---

## Symptom

```typescript
const { data, error } = await supabase
  .from("org_join_requests")
  .select("id, status, users(display_name)");

// error.code = "PGRST201"
// error.message = "Could not embed because more than one relationship was found
//   for 'org_join_requests' and 'users'"
// error.hint = "Try changing 'users' to one of the following: ..."
```

The hint enumerates the FK candidates but the developer reading
the stack trace at 11pm rarely sees it — the surface error in
supabase-js v2 often appears as a generic 4xx with the structured
hint hidden in `error.context` (cf. `[[lsn_supabase_functions_invoke_error_body]]`).

## Why it happens

PostgREST infers embed relationships from foreign-key
declarations. When a single foreign-key path exists between the
two tables, the embed name (`users`) is unambiguous. When two or
more paths exist, PostgREST refuses to guess — it errors with
PGRST201 to force an explicit choice.

Common patterns that trigger this:

| Pattern | Example FKs to `users` |
|---|---|
| Audit-style | `created_by`, `updated_by` |
| Workflow-style | `requester_user_id`, `decided_by` |
| Invitation-style | `inviter_id`, `invitee_id` |
| Mod/handler-style | `flagged_by`, `resolved_by` |

Any table designed to track "who did what to whom" against the
same identity table runs into this.

## The fix

Two equivalent disambiguator syntaxes:

```typescript
// Option A: column-name hint (concise, refactor-friendly)
.select("id, status, users!requester_user_id(display_name)")

// Option B: FK-constraint-name hint (explicit, survives column rename)
.select("id, status, users!org_join_requests_requester_user_id_fkey(display_name)")
```

The default Postgres FK-constraint name follows the pattern
`<table>_<column>_fkey` unless renamed explicitly in the schema.
Both forms work; choose A for readability, B when you have
multiple FKs from the same column-name across child tables and
want maximum clarity.

For multi-FK joins in one query, repeat the disambiguator per embed
and add result-aliases for clean consumer code:

```typescript
.select(`
  id,
  requester:users!requester_user_id(display_name, email),
  decider:users!decided_by(display_name)
`)
// Consumer: row.requester.display_name / row.decider.display_name
```

## When this workflow applies

- A table has two or more FKs to the same target table, and you
  want to embed one of them in a PostgREST query.
- You see PGRST201 in production logs or supabase-js error output.
- `error.hint` lists multiple candidate relationship names — the
  enumeration is the signal.

Find candidate embed-sites that may have latent PGRST201 bugs
across an existing codebase:

```bash
# 1. Tables with multiple FKs to the same target:
psql -c "
SELECT conrelid::regclass AS table, confrelid::regclass AS target, count(*)
  FROM pg_constraint
 WHERE contype = 'f'
 GROUP BY 1, 2
 HAVING count(*) > 1
 ORDER BY 1, 2;
"

# 2. For each (table, target) pair, grep the codebase for naive embeds:
rg "from\(['\"]<table>['\"]\).*select.*['\"]<target>\(" --type ts
# Each hit is a candidate — verify it uses the disambiguator.
```

The TypeScript generated types (`supabase gen types`) do NOT
catch this — the embed-relationship resolution happens at runtime
in PostgREST, not at type-check time. Tests against the actual
PostgREST endpoint are the only reliable gate.

## When NOT to use this workflow

- **Single FK relationship.** PostgREST resolves it without
  hints; adding `!<column>` is unnecessary noise.
- **Cross-table joins via views, not FKs.** Views don't have
  foreign-key metadata; you must JOIN in SQL (RPC) or do two
  queries client-side.
- **You don't actually want the embed.** Sometimes the cleaner
  answer is a SECURITY DEFINER RPC that returns a denormalized
  shape with explicit SQL joins. Embeds are convenient but couple
  the client query plan to PostgREST relationship discovery —
  RPCs decouple cleanly and give you arbitrary SQL.

## Verification

After applying the fix, the previously-failing query should
return embedded data:

```typescript
const { data, error } = await supabase
  .from("org_join_requests")
  .select("id, users!requester_user_id(display_name)")
  .limit(1);

// data[0].users is now an object (1:1) or array (1:N) depending on FK cardinality.
// Type the consumer accordingly: `users: { display_name: string } | { ... }[] | null`.
```

If a fresh PGRST201 fires after the fix, the FK is wrong — verify
the column name in the disambiguator matches an actual FK column,
not a regular column. The PostgREST hint enumerates valid choices.