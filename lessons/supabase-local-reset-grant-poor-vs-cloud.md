---
id: lsn_supabase_local_reset_grant_poor_vs_cloud
title: "Fix a SECURITY INVOKER function that fails locally but serves production — local Supabase is grant-poor"
type: debugging_lesson
tier: community
summary: >-
  A SECURITY INVOKER function fails locally with `permission denied for table X`
  while the same code serves users in the cloud. The `authenticated` table grants
  came from permissive project DEFAULT PRIVILEGES, never from a migration; newer
  local Postgres images harden those defaults, so a freshly reset stack is
  grant-poor relative to the cloud. The tempting fix — rewriting to SECURITY
  DEFINER — trades RLS for a hand-written predicate to appease a local-only
  artifact.
context:
  languages:
    - sql
  platforms:
    - supabase
    - postgres
  tags:
    - supabase
    - postgres
    - grants
    - default-privileges
    - security-invoker
    - rls
    - local-cloud-drift
    - migrations
---

## Symptom

A read path that works for real users fails the moment you exercise it against a
freshly reset local stack:

```
ERROR:  permission denied for table indexed_repo
HINT:   Grant the required privileges to the current role with:
        GRANT SELECT ON public.indexed_repo TO authenticated;
CONTEXT: SQL function "get_nav_capabilities" statement 1
```

The shape is specific: a `SECURITY INVOKER` function (or a direct table read)
that runs under `SET LOCAL ROLE authenticated`, against tables that carry RLS
policies and that the deployed app demonstrably reads every day.

The asymmetry is the tell. A permission bug normally fails everywhere. This one
fails **only** where you just built the database from scratch.

## The two wrong turns

**"Rewrite it as SECURITY DEFINER."** It makes the error disappear, which is
why it is tempting, and it is the expensive mistake: DEFINER bypasses RLS, so
the row filter becomes whatever predicate you write by hand. You have replaced
a database-enforced boundary with an application-shaped one — to satisfy an
environment that no user ever touches. Worse, for any table whose visibility is
non-trivial (team scoping, sharing, org hierarchies) you now have to *reimplement*
that policy in the function body, and the two will drift.

**"Grant the schema and move on."** `GRANT SELECT ON ALL TABLES IN SCHEMA public
TO authenticated` clears the error and silently reverts every deliberate `REVOKE`
a hardening migration ever made. A blanket grant is not a smaller version of a
targeted grant; it is a different change.

## Cause: the grants were never in your migrations

Supabase projects ship default privileges along the lines of

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
```

so for years every new table in `public` arrived with `SELECT` for
`authenticated` already attached. Nobody wrote a `GRANT` because nobody had to.
RLS did the row filtering and the setup worked.

Newer local Postgres images harden that default: tables created by the migration
role no longer hand `SELECT` to `anon`/`authenticated`. An **existing** cloud
project keeps its original, permissive project defaults — those are per-project
state, not per-image.

The result is a divergence with a direction that surprises people:

| | cloud project (created earlier) | fresh local reset (newer image) |
|---|---|---|
| `authenticated` SELECT on new public tables | present | **absent** |
| RLS policies | present | present |
| INVOKER function reading those tables | works | `permission denied` |

RLS policies without a table grant are dead letters — they exist, they look
correct in every review, and they gate nothing because the caller never gets far
enough to be filtered.

This is the mirror image of the better-known drift where a migration passes
locally and fails on first cloud push. Here the *cloud* is the permissive side,
so production keeps working and only reproducibility is broken. That direction
is easier to ignore for far longer.

### The diagnostic that actually decides it

Do not reason from application behaviour. "The dashboard reads this table, so
the grant must exist" is circular: it establishes that *something* reads it, not
that `authenticated` holds a privilege. Ask the catalog instead.

```sql
SELECT c.relname,
       coalesce(string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type), '—')
         AS authenticated_privs
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN information_schema.role_table_grants g
       ON g.table_name = c.relname
      AND g.table_schema = 'public'
      AND g.grantee = 'authenticated'
WHERE n.nspname = 'public'
  AND c.relname IN ('table_a','table_b','table_c')
GROUP BY c.relname
ORDER BY c.relname;
```

Output like `table_a | REFERENCES,TRIGGER,TRUNCATE` — privileges nobody grants on
purpose, with `SELECT` conspicuously absent — is the fingerprint of the hardened
default. A table that *does* carry `SELECT` usually got it from an explicit
migration, and finding one such table among many is a strong hint that somebody
already hit this and fixed a subset.

Run the same query against the cloud before concluding anything about
production. If cloud shows `SELECT` and local does not, you have this problem
and **not** a production incident.

## Fix: explicit grants, scoped, and gated on RLS

Grant exactly the tables the code path needs. In the cloud these statements are
idempotent no-ops; locally they make the migration self-sufficient.

```sql
GRANT SELECT ON public.table_a TO authenticated;
GRANT SELECT ON public.table_b TO authenticated;

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['table_a', 'table_b'] LOOP
    IF NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION '%: authenticated SELECT missing', t;
    END IF;
    -- Without an RLS SELECT policy the grant is an open door, not a repair.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
       WHERE polrelid = ('public.' || t)::regclass
         AND polcmd IN ('r', '*')
    ) THEN
      RAISE EXCEPTION '%: no SELECT policy — refusing to grant', t;
    END IF;
  END LOOP;
END
$do$;
```

The second assertion is the load-bearing half. A grant on an RLS-protected table
restores the intended design; the identical grant on a table with RLS disabled,
or with policies that cover only `INSERT`/`UPDATE`, publishes it. Check
`relrowsecurity` too if your schema has tables where RLS was never enabled:

```sql
SELECT relname, relrowsecurity FROM pg_class
WHERE oid = ANY (ARRAY['public.table_a','public.table_b']::regclass[]);
```

Keep `SECURITY INVOKER`. It is the whole point: RLS stays the row filter, and
your function's own `WHERE user_id = (SELECT auth.uid())` is a second,
independent barrier rather than the only one.

### Verification

Exercise the function the way the app does — as `authenticated`, with a JWT
claim. Called as the migration superuser, `auth.uid()` is NULL and a green run
proves nothing:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<user-uuid>","role":"authenticated"}';
SELECT public.your_function();
ROLLBACK;
```

Two traps worth naming:

- **A skipped gate is not a passed gate.** Test harnesses that need a local
  database commonly *bail open* when it is unreachable, so the run is reported as
  skipped and the pipeline stays green. That is the correct design — a stale
  schema would be worse than no run — but it means the check you were counting on
  may never have executed. Read the skip lines, not just the exit code.
- **Discovery is not coverage.** A gate that auto-discovers `test-*.sql` will
  happily report green for a function nobody wrote a test for. Auto-discovery
  removes the risk of a test being forgotten by the *runner*, never the risk of a
  test not existing.

## When this does NOT apply

- **Both environments deny.** Then the grant is genuinely missing everywhere and
  this is an ordinary permission bug — fix it, but the local/cloud story above is
  not your explanation.
- **Your project deliberately routes all reads through `SECURITY DEFINER` RPCs**
  and revoked table access on purpose. Granting `SELECT` would undo that posture;
  a DEFINER function with an explicit `auth.uid()` filter is then the right shape,
  and the local failure was telling you the truth.
- **A newly created cloud project.** New projects may ship the hardened defaults
  too, in which case cloud and local agree and you will find out at deploy time
  rather than at reset time.
- **The table has no RLS.** Do not grant. Reach for a DEFINER function or add the
  policy first — the assertion above exists to stop exactly this.

## Related

```js
search_lessons({ query: "supabase local reset permission denied authenticated grants differ from cloud", platforms: ["supabase"] })
get_lesson({ id: "lsn_supabase_local_reset_grant_poor_vs_cloud" })
```

- [[lsn_pgcrypto_extensions_schema_prefix]] — the same local-vs-cloud mental model
  running the other way (green locally, fails on first cloud push). Reading both
  together stops you from assuming drift always points one direction.
- [[lsn_postgres_view_security_invoker_default]] — argues, correctly, that you must
  check the app role's base-table grants before choosing `security_invoker`. It
  assumes the deployed environment is the strict one; this entry is the case where
  the deployed environment is the permissive one.
- [[lsn_supabase_revoke_from_public_insufficient_default_privileges]] — the same
  default-privileges machinery at the FUNCTION level, where it grants too much
  instead of too little.
- [[lsn_postgres_security_definer_auth_uid_null]] — read before accepting DEFINER
  as the fix.
- [[lsn_local_vs_cloud_db_environment_check]] — the hygiene layer: know which
  database you are talking to before drawing any conclusion from an error.
