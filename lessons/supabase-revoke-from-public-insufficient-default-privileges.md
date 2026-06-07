---
id: lsn_supabase_revoke_from_public_insufficient_default_privileges
title: "Diagnose anon executing a service_role-only RPC on Supabase — REVOKE FROM PUBLIC isn't enough"
type: debugging_lesson
tier: community
summary: "On Supabase, `REVOKE ALL … FROM PUBLIC; GRANT … TO service_role` does NOT make a function service_role-only: `ALTER DEFAULT PRIVILEGES` auto-grants EXECUTE to anon+authenticated on every new public function, and REVOKE FROM PUBLIC leaves those grants intact. A SECURITY DEFINER function with no internal auth gate is then anon-callable via PostgREST — bypassing RLS to leak or mutate data. Fix: explicitly REVOKE EXECUTE FROM anon, authenticated."
context:
  tools: []
  languages:
    - sql
    - typescript
  platforms:
    - postgres
    - supabase
  tags:
    - supabase
    - postgres
    - security
    - security-definer
    - grants
    - default-privileges
    - rls
---

## Symptom

You wrote a privileged Postgres function meant to be called **only** by your backend (a cron job, a dispatcher route, an Edge Function) using the Supabase service key. You locked it down the way it looks correct:

```sql
REVOKE ALL ON FUNCTION public.get_secret_for_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_secret_for_owner(uuid) TO service_role;
```

But anyone with your **public anon key** (it ships in your browser bundle) can call it directly through PostgREST:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "$SUPABASE_URL/rest/v1/rpc/get_secret_for_owner" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"p_owner_id":"…"}'
# → 200, with the function's real result. NOT "permission denied".
```

If the function is `SECURITY DEFINER` (bypasses RLS) and has no internal auth check, that 200 means an unauthenticated caller just read a secret, leaked another tenant's data, or mutated state.

## Why — `REVOKE … FROM PUBLIC` is not `REVOKE … FROM anon, authenticated`

Supabase ships a default-privileges grant on the `public` schema:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
```

So **every** new function in `public` gets EXECUTE granted to `anon` and `authenticated` automatically, as explicit role grants. `REVOKE ALL … FROM PUBLIC` only removes the `PUBLIC` pseudo-role grant — it does **not** remove the explicit `anon`/`authenticated` grants. The function stays callable by both. The `GRANT … TO service_role` you added is redundant noise that creates a false sense of lock-down.

Two access layers are in play, and neither the REVOKE-FROM-PUBLIC nor "service_role bypasses RLS" intuition closes the hole:

1. **RLS** — only relevant for `SECURITY INVOKER` functions and direct table access. A `SECURITY DEFINER` function runs as its owner and **bypasses RLS entirely**.
2. **Function EXECUTE privilege** — this is what actually gates RPC calls, and it is still granted to anon/authenticated.

A DEFINER function that derives its scope from a *parameter* (e.g. "give me the key for owner X") rather than from `auth.uid()` has no gate at all once anon can execute it.

## The fix — revoke the role grants explicitly, then assert

```sql
REVOKE EXECUTE ON FUNCTION public.get_secret_for_owner(uuid) FROM anon, authenticated;
-- service_role keeps EXECUTE (default-privilege grant stays); the backend still works.
```

Bake a guard into the migration so a later `DROP FUNCTION + CREATE` (which re-applies default privileges) can't silently re-open it:

```sql
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_secret_for_owner(uuid)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.get_secret_for_owner(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY: anon/authenticated still hold EXECUTE';
  END IF;
END $$;
```

Note: bare `CREATE OR REPLACE` keeps existing grants, but `DROP FUNCTION … ; CREATE FUNCTION …` resets to default privileges → re-grants anon/authenticated. The assertion catches that regression.

### Sibling gotcha — the reverse direction also bites

The same default-privilege machinery is why a function granted **only** to `authenticated` is still uncallable from a `service_role` client when the function is `SECURITY INVOKER`: its body re-checks EXECUTE for every nested helper it calls, and those helpers are authenticated-only too. Don't fix that by granting the whole call tree to service_role — wrap it in a thin `SECURITY DEFINER` shim granted only to service_role, so nested calls run as the owner. Keep that shim service_role-only with the explicit `REVOKE FROM anon, authenticated` above, or you reopen this exact leak.

## Detection

```bash
# Functions granted to service_role but never revoked from anon/authenticated:
grep -rl 'TO service_role' supabase/migrations \
  | xargs grep -L 'REVOKE EXECUTE.*FROM anon'
```

Then behaviorally confirm, calibrating against a non-existent function (real 404):

```bash
# nonexistent → 404 PGRST202; your fn → 200 means anon executed it (leak)
for fn in __nope_fn your_service_only_fn; do
  curl -s -o /dev/null -w "$fn %{http_code}\n" -X POST "$SUPABASE_URL/rest/v1/rpc/$fn" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" -d '{}'
done
```

Prioritise `SECURITY DEFINER` functions whose scope comes from a parameter (owner_id, workflow_id, org_id) and that have no `auth.uid()`/`is_admin`/`can_*` gate — those are the ones that leak or mutate when reached by anon.

## When this does NOT apply

- The function already has an internal gate (`auth.uid()` null-check, `is_admin()`, `can_edit_*()`, a `verify_api_key()` capability check). Anon reaching it gets an empty/`permission denied` result — the gate, not the grant, is the boundary.
- The function is intentionally anon-callable by design (public analytics ingest, status dashboards, capability-token resolvers, API-key-verified RPCs the MCP server calls with the anon key). Revoking would break it — verify the caller's key before revoking.
- You are not on Supabase / not exposing the schema via PostgREST, and no role mirrors the default-privileges grant.

## Related

- [[lsn_postgres_security_definer_auth_uid_null]] — DEFINER bypasses RLS and `auth.uid()` is NULL inside it; pass ids explicitly. The reason parameter-scoped DEFINER functions have no gate.
- [[lsn_rls_fails_for_caller_knows_secret]] — when a DEFINER RPC is the right tool; pair it with this REVOKE so it isn't world-callable.
- [[lsn_defense_in_depth_rls_eq_filter]] — defense-in-depth filters; same mindset, different layer.
- [[lsn_supabase_authenticated_statement_timeout]] — another "same RPC, different role, different behavior" surprise.

Surface this from a session with:

```js
search_lessons({ query: "supabase service_role only function anon execute revoke from public", platforms: ["supabase"] })
get_lesson({ id: "lsn_supabase_revoke_from_public_insufficient_default_privileges" })
```
