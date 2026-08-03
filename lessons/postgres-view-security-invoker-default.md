---
id: lsn_postgres_view_security_invoker_default
title: "Fix a cross-tenant leak from a Postgres view — `security_invoker` is not the default"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: []
  languages: [sql]
  platforms: [postgres, supabase, postgrest]
  tags: [postgres, rls, security-invoker, views, supabase-advisor, multi-tenant, cross-tenant-leak]
summary: "A Postgres view runs with its OWNER's privileges unless `security_invoker = on` is set explicitly — the opposite of what many code comments assume. A view owned by a migration superuser and granted to an app role therefore bypasses RLS on its base tables. Worse: `CREATE OR REPLACE VIEW` without a `WITH` clause replaces the view's reloptions wholesale and erases the option with no error, so a later migration can silently reopen the hole."
last_validated_at: "2026-08-02"
---

## The symptom

A view joins two RLS-protected tables and is granted to the app role:

```sql
-- View does not inherit RLS from the base tables — hence SECURITY
-- INVOKER (the default for views) plus the user_id = auth.uid()
-- policy on the base table.        <-- the second half is WRONG
CREATE OR REPLACE VIEW public.thing_status AS
  SELECT ... FROM public.things t LEFT JOIN public.devices d ON ...;
GRANT SELECT ON public.thing_status TO authenticated;
```

The first clause is right, the conclusion is inverted. In Postgres a view's `security_invoker` defaults to **false**: it executes with the privileges of its **owner**. Under Supabase that owner is the migration role, which bypasses RLS. The option only exists from PG 15 and must be set explicitly.

Every authenticated user can now read every row:

```
GET /rest/v1/thing_status?select=*
```

Supabase's advisor reports this as `0010_security_definer_view`, worded as "View is defined with the SECURITY DEFINER property" — even though nothing in the DDL says so. It describes the *default behaviour*, which makes the finding easy to dismiss as a false positive.

### The client-side filter is not a mitigation

Application code frequently carries a comment like "defense in depth: we also filter by user in the query". Against a view that bypasses RLS this is not defence in depth, because the two layers are not independent — the only enforcing layer is the one that is missing. A `.eq("user_id", uid)` shapes what the UI renders; it has no bearing on what the API returns to anyone issuing their own request.

A useful test for any claimed second layer: *can the caller skip it?* If yes, it is a convenience filter, not a control.

## Choose the shape deliberately — the three fixes are not equivalent

| | Leak closed | Advisor quiet | Base tables |
|---|---|---|---|
| A. `security_invoker = on` + base-table grants | yes | yes | readable by app role (RLS-filtered) |
| B. `WHERE owner_col = auth.uid()` inside the view | yes | **no** — lint 0010 is structural | locked |
| C. Replace view with a `SECURITY DEFINER` function that filters | yes | yes | locked |

**A has a cost that is easy to miss.** `security_invoker` moves the privilege check to the caller, so the caller now needs `SELECT` on the base tables. If your app role deliberately has no table grant (common: reads go exclusively through views/RPCs), flipping the option alone yields `permission denied for table ...` and breaks the feature. Granting SELECT fixes that but removes an *independent* barrier: before, both the missing grant and RLS stood in the way; after, RLS is the only thing left. On credential-adjacent tables that is the wrong trade.

Prefer **C** when the base tables are intentionally ungranted:

```sql
DROP VIEW IF EXISTS public.thing_status;

CREATE OR REPLACE FUNCTION public.get_thing_status(p_id uuid DEFAULT NULL)
RETURNS TABLE (...)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public          -- also silences lint 0011
AS $$
  SELECT ...
  FROM public.things t
  LEFT JOIN public.devices d ON d.thing_id = t.id
  WHERE t.owner_id = auth.uid()
    AND (p_id IS NULL OR t.id = p_id);
$$;

REVOKE ALL ON FUNCTION public.get_thing_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_thing_status(uuid) TO authenticated;
```

Lint 0010 covers views only; `SECURITY DEFINER` functions are not flagged. The row filter is now the *sole* barrier, so guard it — a static check over migrations plus an in-migration assertion that `pg_get_functiondef` still contains `auth.uid()`.

### If you keep a view, put the option in the definition

Verified against PG 17.6:

| statement | resulting `pg_class.reloptions` |
|---|---|
| `CREATE VIEW v WITH (security_invoker = on)` | `{security_invoker=on}` |
| `ALTER VIEW v SET (security_invoker = on)` | `{security_invoker=on}` |
| **`CREATE OR REPLACE VIEW v AS ...` (no `WITH`)** | **empty** |
| `CREATE OR REPLACE VIEW v WITH (...) AS ...` | `{security_invoker=on}` |

A bare `CREATE OR REPLACE VIEW` replaces the reloption list in its entirety and drops the option with no error and no warning. A trailing `ALTER` therefore survives only until the next migration touches the view — so the option belongs in the definition:

```sql
CREATE OR REPLACE VIEW public.thing_status
WITH (security_invoker = on) AS
SELECT ...;
```

## Audit, then verify functionally

Inventory every candidate in one query:

```sql
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.reloptions
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v'
  AND coalesce(array_to_string(c.reloptions, ','), '')
      NOT LIKE '%security_invoker=on%';
```

`relkind = 'v'` covers plain views only. Materialized views (`relkind = 'm'`) are a separate class: physical tables, RLS does not apply to them at all, and `security_invoker` does not exist for them — Supabase tracks those under lint `0016_materialized_view_in_api`. Widen to `relkind IN ('v','m')` when taking inventory, and judge matviews on whether their content is genuinely public.

The advisor result is cached, so re-reading it right after the fix proves nothing. Verify behaviourally instead:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<user-a>","role":"authenticated"}';
SELECT count(*) FROM public.<relation>;   -- must show only A's rows
ROLLBACK;
```

Test the targeted case too, not just the unfiltered one: call the relation with another tenant's primary key. A filter that holds for `SELECT *` but not for a known foreign id is not a filter.

Surface this and its neighbours from a session with:

```js
search_lessons({ query: "postgres view security definer bypasses RLS cross-tenant", platforms: ["postgres", "supabase"] })
get_lesson({ id: "lsn_postgres_view_security_invoker_default" })
```

## Gotchas

- The advisor result is cached. After the fix the finding persists until the linter is re-run, so "it didn't help" is not meaningful until you have rerun it.
- Fixing it by hand in the SQL editor is drift: it lives only in the cloud, every fresh environment stays vulnerable, and the next `CREATE OR REPLACE VIEW` migration undoes it. Put it in a migration.
- The lint name says SECURITY DEFINER although the DDL never mentions it. It describes Postgres's default view behaviour, not an attribute someone set — do not dismiss it as a false positive.
- Check the app role's base-table grants BEFORE choosing `security_invoker`. If SELECT was deliberately revoked, the option alone produces `permission denied` and breaks the feature in production.
- RLS policies on a table whose app role has no table grant are dead letters for that path. Their presence is not evidence that a view reading the table is scoped.
- `CREATE OR REPLACE VIEW` also refuses to rename or reorder existing columns (SQLSTATE 42P16), so views accrete append-only column lists — one more reason a function with a free `RETURNS TABLE` ages better.

## When this does NOT apply

- The view exposes data that is genuinely public (status rollups, published content) — owner rights are then irrelevant and the advisor finding is noise you can document rather than fix.
- Your app role has no access to the view at all (granted only to `service_role`), so no untrusted caller can reach it.
- You are not on PG 15+ — `security_invoker` does not exist, and option C (a filtering function) is the only route.
- Related: [[lsn_postgres_security_definer_auth_uid_null]] (`auth.uid()` inside DEFINER contexts — read before relying on option C's filter), [[lsn_supabase_revoke_from_public_insufficient_default_privileges]] (the function-side analogue: default privileges silently re-grant EXECUTE to anon/authenticated), [[lsn_shared_definer_helper_no_authenticated_grant]] (why a DEFINER relation scoped by a *parameter* rather than by `auth.uid()` is the dangerous shape).
