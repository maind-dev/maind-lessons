---
id: lsn_shared_definer_helper_no_authenticated_grant
title: "SECURITY DEFINER helper with a user_id parameter: grant it to no role — only its auth-resolving wrappers may call it"
tier: community
type: workflow_best_practice
summary: DRYing two auth-fronted RPCs into a shared SECURITY DEFINER helper `_rows(p_user_id uuid)` tempts a routine GRANT EXECUTE on it. Don't — it takes user_id as a PARAMETER and bypasses RLS, so any `authenticated` caller can pass another user's id and read cross-tenant data. REVOKE it from PUBLIC and grant it to no role; only the auth-resolving wrappers (which derive user_id from a trusted source) may call it, as the definer.
context:
  tools: []
  languages:
    - sql
  platforms:
    - postgres
    - supabase
  tags:
    - postgres
    - supabase
    - security-definer
    - rls
    - cross-tenant-leak
    - refactoring
---

## The refactor that opens the hole

You have two RPCs returning the same entitled data, differing only in how they authenticate the caller: one resolves `user_id` from an API-key hash, the other from `auth.uid()`. To remove the duplicated query you extract a shared helper:

```sql
create function public._rows(p_user_id uuid) returns jsonb
language sql security definer set search_path = public as $$
  select ... where owner_id = p_user_id ...   -- bypasses RLS (DEFINER)
$$;
```

Then, mechanically, you grant it like the wrappers:

```sql
grant execute on function public._rows(uuid) to authenticated;   -- the bug
```

Now any authenticated user calls `_rows('<someone-else-uuid>')` and reads that user's data. The parameter IS the tenant selector, and you just handed it to the client.

## Why the wrappers are safe but the helper is not

The wrappers are safe because they **derive** `user_id` from something the caller cannot forge — a key hash they must possess, or `auth.uid()` from a signed JWT. The helper is unsafe the moment a caller can choose `p_user_id` freely. Same SQL, opposite trust, because of where the id comes from.

## The fix

```sql
revoke all on function public._rows(uuid) from public;   -- and grant to NO role
```

Grant only the two wrappers' surface (they are `SECURITY DEFINER`, run as the definer, and may call the helper internally). PostgREST will not expose an un-granted function, so there is no direct REST path to it. The auth boundary lives in the wrappers; the shared helper is privileged internals.

## When this does not apply

If the helper derives `user_id` itself (`p_user_id uuid default auth.uid()` AND it ignores any passed value, or it reads `auth.uid()` directly) it cannot be spoofed, and granting it to `authenticated` is fine. The hazard is specifically the combination: **client-suppliable user_id parameter + grant to a callable role**.

## Cross-references

The deeper principle — RLS protects a path only if every path either goes through it or consciously, safely bypasses it — is in [[lsn_rls_fails_for_caller_knows_secret]]. "Own data via auth.uid()" is the safe case; "any row via a chosen id" is the leak.
