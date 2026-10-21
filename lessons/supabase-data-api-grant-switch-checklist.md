---
id: lsn_supabase_data_api_grant_switch_checklist
title: "Before Supabase's Data API grant switch (2026-10-30): checklist for projects where agents write migrations"
type: recipe
tier: community
summary: >-
  From 2026-10-30 every existing Supabase project stops granting anon,
  authenticated and service_role anything on NEW public tables and sequences
  (new projects since 2026-05-30). Existing tables keep their grants. Agents
  that write migrations from older habits create tables nobody can reach,
  including your backend's service key. Checklist: find out which default you
  are on, opt in early, write every new table convergently, check replays.
last_validated_at: "2026-10-20"
evidence: "Supabase changelog #45329 (2026-04-28); Supabase CLI v2.106.0 release notes; supabase/agent-skills SKILL.md v0.1.2"
tool_versions:
  supabase-cli: "2.106.0"
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
    - data-api
    - service-role
    - rls
    - migrations
    - checklist
    - agents
---
## What changes, in one table

Supabase changelog #45329 (published 2026-04-28) removes the default that gave
every new `public` table full CRUD for the Data API roles.

| | before | after |
|---|---|---|
| new table: `anon`, `authenticated` | `SELECT, INSERT, UPDATE, DELETE` (and more) | nothing |
| new table: `service_role` | all privileges | **nothing** |
| new sequence: the three roles | `USAGE, SELECT` | nothing |
| existing tables and sequences | unchanged | unchanged |
| when | — | new projects since 2026-05-30; every existing project on **2026-10-30** |

What a missing grant looks like: REST returns `42501 permission denied for table
your_table` (HTTP 403 for a signed-in caller, 401 otherwise) with a hint naming
the `GRANT` to add. GraphQL is quieter: a table the role cannot read disappears
from its schema without an error.

Two things the announcement does not settle, so verify them in your project
rather than assume: whether function defaults are revoked too (the announced
opt-in SQL covers tables and sequences only; Studio's Data API toggle and the
local CLI also revoke function defaults), and whether `TRUNCATE`, `REFERENCES`
and `TRIGGER` survive the revoke (community reports say they do).

Why agents are the risk: an agent writes migrations from patterns it learned
when grants arrived for free. Supabase's own agent skill (supabase/agent-skills,
v0.1.2) tells it to grant `anon` and `authenticated`, but does not mention
`service_role` — so the table your edge function or server code reads with the
service key is the one that breaks.

## Once per project, before 2026-10-30

1. **Find out which default you are on.** Run this in the cloud project and in
   your local stack:

   ```sql
   SELECT coalesce(defaclnamespace::regnamespace::text, 'GLOBAL') AS schema,
          defaclobjtype, defaclacl
   FROM pg_default_acl
   WHERE defaclrole = 'postgres'::regrole
   ORDER BY 1, 2;
   ```

   `public | r` with `anon`, `authenticated` or `service_role` carrying
   `arwd` is the old default. Without them, the next table arrives with
   nothing. A local stack started before Supabase CLI v2.106.0 may still be on
   the old default while a fresh one is not.

2. **Opt in early, in a migration.** The changelog's opt-in statements make the
   cloud behave on your schedule instead of on the date, and the migration
   makes local, CI and every branch identical:

   ```sql
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
     REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
     REVOKE USAGE, SELECT ON SEQUENCES FROM anon, authenticated, service_role;
   ```

3. **List what reads tables with the service key.** Edge functions and server
   code that use the service key directly (`from('table')` on a service-role
   client), not through a `SECURITY DEFINER` function. Every such table created
   after the switch needs an explicit `GRANT … TO service_role`. Existing tables
   are fine.

4. **Check migrations that are written but not yet pushed.** A table is
   stamped when the migration runs in the cloud, not when the file was
   written. A migration pushed after 2026-10-30 creates its tables under the new
   default, whatever its timestamp says.

5. **Replay your history once on a fresh stack.** Start a throwaway local
   project with a current CLI and apply all migrations. Old migrations that
   assert a grant the old default stamped (for example
   `has_table_privilege('service_role', 'public.old_table', 'SELECT')`) fail
   there. One faithful fix: at the top of your earliest migration, restore the
   historical default, so the replay stamps old tables as the cloud did; the
   opt-in migration from step 2 removes it again. The cloud does not re-run an
   applied migration, so only replays see the edit.

   ```sql
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
     GRANT ALL ON TABLES TO anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
     GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
   ```

## Every new table

Write the ACL convergently — revoke first, then grant exactly what is needed —
so the migration lands in the same state on the old default, the new default
and a fresh replay:

```sql
CREATE TABLE public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  body text NOT NULL
);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.notes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.notes TO authenticated;          -- what the policies below need
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO service_role;
                                                                -- only if server code uses the service key

CREATE POLICY notes_read_own   ON public.notes FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY notes_insert_own ON public.notes FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DO $$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.notes', 'SELECT')
     OR has_table_privilege('anon', 'public.notes', 'SELECT') THEN
    RAISE EXCEPTION 'notes: unexpected ACL';
  END IF;
END $$;
```

Three rules make this reviewable:

- **Every policy needs a matching grant.** A policy `FOR SELECT TO
  authenticated` without `GRANT SELECT … TO authenticated` gates nothing: the
  caller gets `42501` before RLS runs. Either grant the command or drop the
  policy.
- **Decide `service_role` per table.** Grant it when server code reads the
  table with the service key; leave it out when the table is reached only
  through `SECURITY DEFINER` functions. Either way the `REVOKE` line names it,
  so the decision is visible in review.
- **Keep grants inside the policies' shape.** Never grant a role a command no
  policy allows, and never grant on a table without RLS — on the old default
  that is what made tables world-readable.

Tables with `serial` or `bigserial` columns: grant `USAGE` on the sequence to
every role that inserts. Identity columns (`GENERATED … AS IDENTITY`) do not
need it.

## A line for your agent's instructions

Supabase recommends updating the agent's system prompt. A version that covers
`service_role`:

> When a migration creates a table in `public`: enable RLS; `REVOKE ALL` on it
> from `PUBLIC, anon, authenticated, service_role`; grant each role exactly the
> commands its policies name; grant `service_role` only if server code reads the
> table with the service key; assert the result with `has_table_privilege`.

## After 2026-10-30

- Re-run the `pg_default_acl` query in the cloud. Check the `f` (functions)
  rows too: if the function default for `service_role` is gone and you had
  already revoked the global `PUBLIC` default for functions, new functions need
  `GRANT EXECUTE … TO service_role`.
- Watch logs for `42501` on tables created after the date.

## Sources and related

- Supabase changelog #45329, "Tables not exposed to Data and GraphQL API
  automatically", 2026-04-28:
  https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- Supabase discussion #45329 (edit history: function revokes removed from the
  announcement on 2026-04-28): https://github.com/orgs/supabase/discussions/45329
- Supabase CLI v2.106.0 (local start/reset revoke the defaults, flag
  `[api].auto_expose_new_tables`): https://github.com/supabase/cli/releases/tag/v2.106.0
- Supabase docs, "Securing your API": https://supabase.com/docs/guides/api/securing-your-api
- Supabase GraphQL security (revoked tables leave the schema):
  https://supabase.com/docs/guides/graphql/security
- supabase/agent-skills, `skills/supabase/SKILL.md` v0.1.2:
  https://github.com/supabase/agent-skills

Related entries:

- [[lsn_supabase_table_default_privileges_convergent_acl]] — why the convergent
  form exists and how to simulate the old default before pushing.
- [[lsn_supabase_local_reset_grant_poor_vs_cloud]] — local and cloud defaults
  diverging, and where the gap moves after the switch.
- [[lsn_supabase_revoke_from_public_insufficient_default_privileges]] — the
  function side, which the switch does not retire.