---
id: lsn_pgcrypto_extensions_schema_prefix
title: "SQLSTATE 42883 — qualify pgcrypto as `extensions.digest()` on Supabase Cloud (generated columns trap)"
class: lesson
type: debugging_lesson
tier: community
context:
  tools: []
  languages:
    - sql
  platforms:
    - supabase
    - postgres
  tags:
    - supabase
    - postgres
    - pgcrypto
    - search-path
    - generated-columns
    - migrations
    - sqlstate-42883
    - local-cloud-drift
last_validated_at: "2026-05-28"
summary: |
  On Supabase Cloud `pgcrypto` lives in the `extensions` schema. The migration role's search_path is `public, pg_temp` — so bare `digest(...)` calls fail with SQLSTATE 42883 ("function digest(text, unknown) does not exist"). Generated columns are the hardest hit because they cannot `SET search_path` like a function can; schema-qualification is mandatory. Local Supabase CLI typically hides the bug because its API role's default search_path includes `extensions`.
---

A migration that worked perfectly against local Supabase CLI fails on the first `db push --linked` to a freshly created cloud project:

```
NOTICE (42710): extension "pgcrypto" already exists, skipping
...
ERROR: function digest(text, unknown) does not exist (SQLSTATE 42883)
At statement: 22
-- audit_log — append-only audit trail with per-user SHA-256 hash chain
...
  row_hash text generated always as (
    encode(
      digest(
  ^
```

Same SQL file. Bug appears the moment it touches a cloud project.

## Why local hides it — and why generated columns have no workaround

The local Supabase CLI typically configures the API role's search_path to include `extensions, public`, so bare `digest(...)` resolves. On cloud, `pgcrypto` is also installed in `extensions` — but the `authenticated`/`postgres` migration role search_path is `public, pg_temp` only. The function exists, the call can't find it.

Confirm in the cloud SQL Editor:

```sql
-- Function exists in extensions
SELECT n.nspname AS schema, p.proname
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'digest';
-- → extensions | digest

-- But the search_path doesn't include extensions
SHOW search_path;  -- → "$user", public
```

For ordinary SECURITY DEFINER functions there's an inline workaround:

```sql
CREATE OR REPLACE FUNCTION public.my_fn(...)
RETURNS ... LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp   -- ← inline override
AS $$ ... $$;
```

**Generated columns have no such clause.** There is no `SET search_path` for a generated-column expression — the schema-qualified call is the *only* way to make a generated column portable between local and cloud:

```sql
-- BREAKS on cloud, works on local:
row_hash text generated always as (
  encode(digest(... , 'sha256'), 'hex')
) stored

-- Works on both:
row_hash text generated always as (
  encode(extensions.digest(... , 'sha256'), 'hex')
) stored
```

This is the unique constraint: SECURITY DEFINER call sites have a workaround, generated columns don't. If a migration mixes both styles, the generated columns are the ones that fail in production.

## The fix — qualify pgcrypto functions explicitly

```sql
-- Generated column (cloud-portable)
row_hash text generated always as (
  encode(
    extensions.digest(           -- ← qualified
      coalesce(prev_hash,'') || '|' || ...,
      'sha256'
    ),
    'hex'
  )
) stored

-- SECURITY DEFINER helper (same convention for consistency,
-- even though SET search_path would work here too)
CREATE OR REPLACE FUNCTION public.log_audit(...)
... SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  v_payload_hash := encode(extensions.digest(p_payload::text, 'sha256'), 'hex');
  ...
END $$;
```

`encode()` stays unqualified — it is a `pg_catalog` built-in, always on the search_path. Same for `gen_random_uuid()` since Postgres 13 (built-in, no extensions. prefix needed).

**On atomic rollback:** Postgres applies each migration in a transaction. A mid-migration 42883 rolls back cleanly — `supabase migration list --linked` shows an empty Remote column for the failed file, confirming nothing persisted. Fix the migration files in place (not as a repair migration), re-push, done. No phantom-migration risk in this specific scenario — see [[lsn_supabase_phantom_migrations]] for cases where it *is* a risk.

## Detection across the codebase

```bash
# Find unqualified pgcrypto function calls in migrations:
grep -nE '\b(digest|pgp_sym_encrypt|pgp_sym_decrypt|hmac|crypt|gen_salt)\(' \
     supabase/migrations/*.sql \
  | grep -vE 'extensions\.'
# Each hit needs `extensions.` prefix, or an explicit SET search_path on the
# surrounding function (only available for non-generated-column call sites).
```

The grep is intentionally narrow to the most common pgcrypto entry points. `encode`/`decode`/`gen_random_uuid` are built-ins and excluded — they don't need qualification. Run once per migration after authoring; re-run before each new cloud cutover.

## Anti-patterns

- **`CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public`** — Supabase Cloud already has pgcrypto in `extensions`. The `IF NOT EXISTS` skip means the `WITH SCHEMA public` clause is silently ignored → false sense of security. `ALTER EXTENSION pgcrypto SET SCHEMA public` either fails on permissions or breaks built-in Supabase functions that expect pgcrypto in `extensions`.
- **`ALTER ROLE authenticated SET search_path = public, extensions, pg_temp`** — works in the project where you ran it; doesn't travel with the migration file. The next environment (staging, new dev's local, a CI ephemeral project) won't have it. Convention drift waiting to happen.
- **Wrapping `digest()` in a `public.sha256_hex(text)` helper that does the SET search_path internally** — fine for SECURITY DEFINER call sites, but a generated column still needs to call the helper schema-qualified (`public.sha256_hex(...)`), so the problem has moved one hop, not been solved.
- **Catching the 42883 at the app layer** — irrelevant; the migration itself fails, the app never connects to a working schema.

## When this does not apply

- Local-only development with no cloud target — bare `digest(...)` keeps working, qualification is optional cosmetic.
- Postgres without pgcrypto loaded (`gen_random_uuid` since v13 is built-in, no pgcrypto needed). If the migration only uses `gen_random_uuid()`, this convention is moot.
- Self-hosted Postgres where you control the migration role's search_path globally and accept that the SQL file is non-portable to managed hosts.
- Functions called via REST/RPC from PostgREST — the API role search_path is separately configurable in `supabase/config.toml` `[api].extra_search_path`. If your only pgcrypto calls live inside such RPCs and never in generated columns, you can rely on that config — but the file still won't port to other Supabase projects without the same config.

## Related vetted conventions

- [[lsn_supabase_seed_is_source_of_truth]] — another instance of local-cloud-drift: seed.sql is local-only, cloud requires explicit seed migrations. Same mental model (local-state ≠ cloud-state) applies.
- [[lsn_supabase_phantom_migrations]] — failure-mode adjacent: when the migration ledger lies. Distinguishing "transactional rollback (nothing persisted)" from "phantom (ledger says applied, schema doesn't have it)" matters when triaging `db push` errors.
- [[lsn_postgres_strict_mode_volatility]] — another search_path / volatility class of SQL portability bug surfacing only on managed hosts.
- [[lsn_postgres_enum_text_cast]] — different SQLSTATE 42883 cause (operator mismatch, not schema resolution). Listed here so triage doesn't conflate.
