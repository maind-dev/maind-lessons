---
id: lsn_dedup_key_scope_discriminator
title: "Fix a dedup key that silently merges two scopes sharing the same nullable tenant columns"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [sql, typescript]
  platforms: [postgres, supabase]
  tags: [deduplication, multi-tenant, null-safety, idempotency, postgres]
summary: "When you add a new visibility scope (such as private) that reuses the same nullable tenant columns as an existing scope (such as public, both with tenant_id NULL), an existing content-hash dedup key silently deduplicates the new scope's row against the old one. Put the scope discriminator in the key AND coalesce nullable tenant columns to a sentinel for NULL-safe equality."
last_validated_at: "2026-06-09"
---

## Symptom

You add a new visibility scope to a content table — say `private`
alongside an existing `public` — both stored with `tenant_id IS NULL`
(only org/team content sets the tenant). A user submits content as
`private`, but instead of a new row they get back an **existing
`public` draft** with the same payload. The private row is never
created. No error is raised.

## Root cause

Two independent bugs surface in one dedup query:

1. **The dedup key never included the scope discriminator.** It keyed on
   `(created_by, content_hash, tenant)`. Before the new scope existed,
   that was unique enough. The moment a second scope reuses the same
   nullable tenant columns, two scopes become indistinguishable under
   the key → the first matching row wins.

2. **NULL-unsafe equality on the nullable tenant column.** `tenant = NULL`
   is never true in SQL (it evaluates to `UNKNOWN`). A naive
   `WHERE tenant = p_tenant` matches nothing when both are NULL; "fixing"
   it with `IS NOT DISTINCT FROM` then matches *across* scopes. Either
   way the scope boundary is not enforced by the key.

## Fix

Put the scope discriminator **in the key**, and coalesce nullable tenant
columns to a sentinel UUID for NULL-safe equality:

```sql
-- BEFORE (collapses scopes that share NULL tenant columns):
SELECT id FROM content
 WHERE created_by   = p_user
   AND content_hash = p_hash
   AND tenant_id    = p_tenant_id          -- NULL = NULL -> never true
   AND status IN ('pending','merged');

-- AFTER (scope-distinct, NULL-safe):
SELECT id FROM content
 WHERE created_by   = p_user
   AND content_hash = p_hash
   AND coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     = coalesce(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
   AND scope        = p_scope               -- the discriminator
   AND status IN ('pending','merged');
```

If dedup is enforced by a UNIQUE index rather than an RPC lookup, the
index must include the scope column and a coalesced/expression tenant
column (a partial or expression index), not the raw nullable one.

## Verification

```sql
-- Same hash + same user, two different scopes -> must yield TWO rows:
INSERT INTO content (created_by, content_hash, tenant_id, scope)
VALUES (u, h, NULL, 'public'), (u, h, NULL, 'private');

SELECT scope, count(*) FROM content
 WHERE created_by = u AND content_hash = h
 GROUP BY scope;
-- expect: public=1, private=1 (NOT a single deduplicated row)
```

## When it applies

Any content / event / idempotency table where a row's *effective
identity* includes a visibility or routing scope, and some scopes leave
the tenant column(s) NULL. The trap fires exactly when you ADD a scope
later: the existing key was only "accidentally unique" because there was
a single scope in the NULL-tenant space. Audit every dedup key and
UNIQUE constraint the moment you introduce a new scope that overlaps
existing nullable discriminators.

## When this does NOT apply

- Single-scope tables, or tables where the scope already lives in a
  NOT NULL column that is part of the key — there is no NULL-overlap.
- Append-only logs with no dedup / idempotency requirement.
- When scopes intentionally share identity (one row spans scopes on
  purpose) — then the merge is the feature, not a bug.

Related: [[lsn_postgres_trigger_silent_default_masks_bug]] — the sibling
failure where a BEFORE-INSERT trigger silently routes a row into the
wrong context instead of a dedup key silently merging scopes.
