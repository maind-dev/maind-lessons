---
id: lsn_postgres_definer_helper_auth_wrappers
title: "One privileged query, many identities: user-keyed DEFINER helper + thin auth wrappers instead of RPC body twins"
type: workflow_best_practice
tier: community
summary: "When one privileged Postgres query must serve several identity sources (API-key hash, cookie/auth.uid(), later a CI token), don't clone the RPC body per auth path — clones drift silently. Extract the logic into an internal SECURITY DEFINER helper keyed on p_user_id (explicit REVOKE from anon+authenticated + assertion); thin wrappers only derive the user id. Verify: diff old body vs helper modulo rename; check rollout via the migration ledger (revoked functions 404 like missing ones)."
context:
  tools: []
  languages:
    - sql
  platforms:
    - postgres
    - supabase
  tags:
    - security-definer
    - rls
    - auth
    - migrations
    - supabase
    - refactoring
---

## The situation

A DEFINER RPC exists, keyed on one identity source — e.g. a semantic search that
resolves `v_user_id` from an API-key hash (`api_keys` lookup). Now a second surface
needs the SAME query with a DIFFERENT identity source: a cookie-authenticated
dashboard (`auth.uid()`), later maybe a CI token.

Two tempting shortcuts, both wrong:

- **A parameter-keyed twin granted to clients** (`search(p_user_id uuid, …)` for
  `authenticated`): anyone can pass a foreign uuid — cross-tenant leak
  ([[lsn_rls_fails_for_caller_knows_secret]]).
- **A service_role-only twin with a copied body:** safe today, but now the query
  logic exists twice. The copies drift silently on the next feature (an added join,
  a changed filter) — the classic body-drift failure class
  ([[lsn_postgres_function_overload_silent]] is the same disease at the signature
  level).

## The pattern: helper + thin auth wrappers

```sql
-- 1) ALL the logic, keyed on an explicit user id. Never client-callable.
create function public._search_rows(p_user_id uuid, ...) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
  -- validation + the entire query, using p_user_id
$$;

revoke all on function public._search_rows(uuid, ...) from public;
-- REVOKE FROM PUBLIC is NOT enough on Supabase: default privileges grant
-- EXECUTE to anon+authenticated on every new public function.
revoke execute on function public._search_rows(uuid, ...) from anon, authenticated;

-- 2) Thin wrappers: derive the user id, delegate. Nothing else.
create function public.search(p_api_key text, ...) returns jsonb ... as $$
  -- key-format check, hash lookup -> v_user_id, then:
  return public._search_rows(v_user_id, ...);
$$;   -- grant to anon, authenticated (key-gated internally)

create function public.search_dashboard(...) returns jsonb ... as $$
  return public._search_rows(auth.uid(), ...);
$$;   -- revoke from anon; grant to authenticated only
```

Plus an assertion so a later `DROP FUNCTION + CREATE` (which re-applies default
privileges) fails loudly instead of silently re-opening the helper:

```sql
do $$ begin
  if has_function_privilege('anon', 'public._search_rows(uuid, ...)', 'EXECUTE')
  or has_function_privilege('authenticated', 'public._search_rows(uuid, ...)', 'EXECUTE') then
    raise exception 'SECURITY: client roles must not execute _search_rows';
  end if;
end $$;
```

The next identity source (CI token, admin surface) is another 5-line wrapper — never
another copy of the query.

## Keeping the refactor regression-free

- **Preserve the original wrapper's check ORDER** (e.g. invalid_key →
  invalid_project_key → invalid_embedding → key resolution) so even error outputs
  stay byte-identical for existing callers; duplicate cheap validations in the
  helper if you want one source of truth — the wrapper's checks then simply fire
  first.
- **Prove it mechanically:** extract the query block from the old migration and the
  helper, normalize the identity variable name, and diff:

  ```bash
  sed -n '/v_vec :=/,/return jsonb_build_object/p' old.sql >/tmp/old.sql
  sed -n '/v_vec :=/,/return jsonb_build_object/p' new.sql | sed 's/p_user_id/v_user_id/g' >/tmp/new.sql
  diff /tmp/old.sql /tmp/new.sql   # empty = logic identical modulo rename
  ```

## Verifying the rollout (the 404 trap)

Behavioral probes via PostgREST are ambiguous here: a function the calling role
cannot EXECUTE returns **404 — indistinguishable from "does not exist"** (calibrate
against a deliberately nonexistent function name). So a 404 on the new wrapper does
NOT tell you whether the migration is missing or the grant is (correctly) locked
down. Disambiguate with the migration ledger (`supabase migration list --linked`)
plus the in-migration assertion — the push itself would have failed on a bad grant.

## When this does NOT apply

- Only one identity source, now and foreseeably — a single RPC is simpler; extract
  the helper when the second auth path actually arrives.
- The two callers need genuinely DIFFERENT queries (not the same logic with a
  different user id) — then they are not twins, and separate functions are honest.
- Row-level scoping fully expressible via RLS on the tables with `auth.uid()` —
  plain SECURITY INVOKER + RLS beats a DEFINER helper
  ([[lsn_postgres_security_definer_auth_uid_null]] for why DEFINER changes the
  auth.uid() rules).

## Related

- [[lsn_supabase_revoke_from_public_insufficient_default_privileges]] — why the
  explicit anon/authenticated revoke + assertion are load-bearing.
- [[lsn_rls_fails_for_caller_knows_secret]] — why the parameter-keyed client-callable
  variant is a leak.
- [[lsn_postgres_function_overload_silent]] — drop/recreate discipline for the
  wrapper signatures.

```ts
search_lessons({ query: "security definer helper wrapper multiple auth identity user id rpc duplicate body", platforms: ["supabase"] })
```
