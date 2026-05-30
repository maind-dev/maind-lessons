---
id: lsn_postgres_text_uuid_no_implicit_cast
title: "SQLSTATE 42883 'operator does not exist: text = uuid' — cast uuid::text on the safer side"
class: lesson
type: debugging_lesson
tier: community
context:
  tools: []
  languages:
    - sql
  platforms:
    - postgres
    - supabase
  tags:
    - postgres
    - type-coercion
    - uuid
    - sqlstate-42883
    - debugging
last_validated_at: "2026-05-29"
summary: |
  Postgres rejects text=uuid comparisons with SQLSTATE 42883 — no implicit cast exists. Use ::text on the uuid side (safer than text::uuid, which fails on non-UUID rows with 22P02).
---

Postgres treats `text` and `uuid` as distinct types with no implicit comparison operator between them. Any direct comparison — `=`, `IN`, `ANY`, join condition — fails at planning time with:

```
ERROR:  42883: operator does not exist: text = uuid
HINT:  No operator matches the given name and argument types. You might
       need to add explicit type casts.
```

This is unlike `text` vs `varchar` (implicit cast exists) or `int` vs `bigint` (implicit cast in many directions). Postgres is strict about UUID specifically because the format is structured (32 hex digits + 4 hyphens) and silent coercion could mask data-quality bugs.

## Where this bites in real codebases

The most common shape is admin/cleanup scripts that join a "child" table whose foreign-key was stored as text (for JWT-sub-claim compatibility, or for cross-source-id flexibility) against the parent `auth.sessions` / `auth.users` table where the primary key is `uuid`:

```sql
-- FAILS with 42883
DELETE FROM public.user_session_aal
 WHERE session_id IN (
   SELECT id FROM auth.sessions WHERE user_id = '<uid>'
 );
```

The `session_id` column in `user_session_aal` was deliberately `text` — values come from JWTs as base64url strings. `auth.sessions.id` is `uuid`. The `IN` operator requires same types on both sides; Postgres won't pick one to cast.

## The fix

Cast explicitly on one side. The safe direction is **uuid → text** because `uuid::text` always produces the canonical 36-character form with hyphens, which matches what the JWT-sub claim emits:

```sql
-- WORKS
DELETE FROM public.user_session_aal
 WHERE session_id IN (
   SELECT id::text FROM auth.sessions WHERE user_id = '<uid>'
 );
```

The reverse direction (`text::uuid`) is **unsafe** when the text values aren't guaranteed UUIDs — e.g. if the text column also stores non-UUID session identifiers (some JWT issuers emit non-UUID `sub` claims). Casting text → uuid raises `22P02 invalid input syntax for type uuid` on any non-conforming row.

## Schema design discipline

When you deliberately choose `text` for a column that will frequently be compared against `uuid` from a sibling table, leave a comment:

```sql
CREATE TABLE public.user_session_aal (
  session_id text PRIMARY KEY,
  ...
);

COMMENT ON COLUMN public.user_session_aal.session_id IS
  'JWT sub claim. Stored as text because the source format is base64url, not UUID. '
  'Comparisons against auth.sessions.id (uuid) need explicit ::text cast on the uuid side.';
```

This is the kind of context that gets lost in months and pops up exactly when an admin tries to clean up via ad-hoc SQL.

## When this does not apply

If both sides are already the same type (uuid=uuid or text=text), no cast is needed — and you should NOT add one defensively, since a cast on an indexed column can block index use. The cast is specifically for the cross-type comparison; don't sprinkle `::text` on uuid columns that are compared against other uuids.

## Why this is worth knowing

The error message is misleading on first read — "operator does not exist" sounds like a syntax error, but the operator (`=`) very much exists, just not for this type combination. Developers who haven't hit it before typically search for it once, find the cast solution, fix it, and forget — until the next time. The convention captures both the cast rule and the safe-direction heuristic (uuid::text is safer than text::uuid in mixed-format data).

## Related but distinct

- `lsn_postgres_enum_text_cast` covers enum-vs-text[] (array) comparisons with the same 42883 SQLSTATE but a different cast pattern (enum::text on the column side, against the text[] parameter).
- `lsn_postgres_returns_table_column_collision` covers 42702 (ambiguous-column), a sibling error class but for a different cause.