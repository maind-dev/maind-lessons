---
id: lsn_supabase_table_default_privileges_convergent_acl
title: "Fix a lockdown migration that fails its own ACL assertion on db push — Supabase stamps new tables with ALL"
type: debugging_lesson
tier: community
summary: >
  A migration that creates an RLS-protected table, grants only SELECT, and
  asserts its lockdown (writes only via DEFINER RPCs, anon reads nothing)
  passes locally and fails on `db push` — on its own assertion. Cloud DEFAULT
  PRIVILEGES hand ALL on new tables to anon/authenticated at CREATE time;
  function-level default-privilege hardening does NOT cover tables. Fix:
  convergent ACLs — REVOKE ALL first, then GRANT what you mean. Verify by
  simulating the cloud grants locally.
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
    - grants
    - default-privileges
    - rls
    - local-cloud-drift
    - migrations
    - acl
---
## Symptom

A migration creates a new RLS-protected table whose writes are meant to go
exclusively through `SECURITY DEFINER` RPCs. It grants `SELECT` to
`authenticated` (an INVOKER read path needs it) and ends with an assertion of
exactly that posture:

```sql
IF has_table_privilege('authenticated', 'public.new_table', 'INSERT')
   OR has_table_privilege('anon', 'public.new_table', 'SELECT') THEN
  RAISE EXCEPTION 'lockdown violated: writes only via DEFINER RPCs, anon reads nothing';
END IF;
```

Locally everything is green. On `supabase db push` the same file fails — on its
own assertion:

```
Applying migration 20260825230000_work_object_labels.sql...
ERROR: lockdown violated: writes only via DEFINER RPCs, anon reads nothing (SQLSTATE P0001)
```

## Cause: table default privileges, and why function hardening did not save you

Existing Supabase cloud projects carry default privileges along the lines of

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
```

so the moment your `CREATE TABLE` completes, `authenticated` holds `INSERT`
and `anon` holds `SELECT` — before your own `GRANT SELECT` line ever runs.
Your additive grant changed nothing about that; the assertion then told the
truth.

Two details make this easy to mispredict:

- **Function-level hardening does not cover tables.** If the project already
  ran `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS
  FROM PUBLIC, anon;`, that fixed *functions only*. `ON TABLES` is a separate
  default-ACL entry, and the permissive table default keeps stamping every new
  relation regardless.
- **Local does not reproduce it.** Newer local Postgres images are grant-poor
  (the opposite failure: an INVOKER read dies with `permission denied` until
  you grant explicitly — see [[lsn_supabase_local_reset_grant_poor_vs_cloud]]).
  So the permissive starting state exists only in the environment you test
  last.

## Fix: convergent ACLs — cut first, then grant what you mean

```sql
REVOKE ALL ON public.new_table FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.new_table TO authenticated;   -- and nothing else
```

On the grant-poor local side the `REVOKE` is a no-op; on the grant-rich cloud
side it strips the default `ALL`. Both environments land on the identical,
asserted end state. Keep the assertion — it is what turned a silent,
security-relevant drift (an anon-readable table) into a loud push failure.

The general rule: **a migration that both creates a relation and asserts its
ACL must write that ACL convergently (REVOKE + GRANT), never additively.**
Additive grants encode an assumption about the starting state, and the
starting state is precisely what differs between local and cloud.

## Verification and cleanup

Simulate the cloud before pushing:

```sql
-- fake the cloud default on the freshly created table:
GRANT ALL ON public.new_table TO authenticated, anon;
-- re-run the migration file end to end:
--   the REVOKE must strip the fake grants, the assertion must pass.
```

Then confirm the end state from the catalog, not from app behaviour:

```sql
SELECT has_table_privilege('authenticated','public.new_table','INSERT'),  -- f
       has_table_privilege('anon','public.new_table','SELECT'),           -- f
       has_table_privilege('authenticated','public.new_table','SELECT');  -- t
```

On the failed push itself: the migration applies in one transaction, so the
assertion failure rolled back atomically — the remote ledger records nothing,
and the file can be fixed **in place** and re-pushed. No repair migration, and
no phantom risk in this scenario (see [[lsn_supabase_phantom_migrations]] for
the cases where the ledger does lie).

## When this does NOT apply

- **The table is meant to be client-writable** (RLS policies govern INSERT/
  UPDATE directly). Then `authenticated` holding `INSERT` is the design, not a
  violation — there is no lockdown to assert, and the default grant is merely
  broader than the policies allow through.
- **A newly created cloud project** may ship hardened table defaults too; if
  cloud and local agree, additive grants behave identically everywhere — the
  convergent form then costs nothing and still protects you against the next
  project.
- **`service_role`** is deliberately left out of the REVOKE above: platform
  tooling expects it, it bypasses RLS by design, and the lockdown assertions
  do not constrain it. Include it only if your posture explicitly demands so.

## Related

- [[lsn_supabase_local_reset_grant_poor_vs_cloud]] — the same divergence seen
  from the other side: grant-poor local breaks INVOKER reads while the
  permissive cloud keeps serving. Read both directions together.
- [[lsn_supabase_revoke_from_public_insufficient_default_privileges]] — the
  FUNCTION-level sibling: default privileges silently re-grant EXECUTE to
  anon/authenticated, and `REVOKE FROM PUBLIC` alone does not remove direct
  grants.
- [[lsn_postgres_view_security_invoker_default]] — why table grants and RLS
  interact the way they do for INVOKER relations.

```js
search_lessons({ query: "supabase table default privileges lockdown revoke grant convergent acl", platforms: ["supabase"] })
```