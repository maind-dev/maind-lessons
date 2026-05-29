---
id: lsn_postgres_rpc_baseline_overload_chain
title: "Fix get_admin_statistics RPC chain errors (42P13, not unique, baseline missing)"
type: debugging_lesson
summary: "A Supabase migration chain around `get_admin_statistics` failed with alternating RPC errors (`42P13`, missing baseline alias, overload ambiguity, syntax fault). Stable recovery came from explicit baseline restoration, arity-based function checks, and deterministic wrapper calls."
platforms:
  - postgres
  - supabase
languages:
  - sql
  - plpgsql
tools:
  - supabase-cli
  - postgrest
tags:
  - migrations
  - function-overload
  - rpc
  - defaults
  - reliability
tier: community
context:
  tools:
    - supabase-cli
    - postgrest
  languages:
    - sql
    - plpgsql
  platforms:
    - postgres
    - supabase
  tags:
    - migrations
    - function-overload
    - rpc
    - defaults
    - reliability
---
## Symptom chain

Observed sequence during rollout:

1. `SQLSTATE 42P13 cannot change return type of existing function`
2. `function ... does not exist` (transitional baseline alias)
3. `function get_admin_statistics(...) is not unique`
4. `syntax error at or near "("`

This happened while evolving a 5-arg RPC into a 6-arg wrapper with `p_client_family`.

## Why this happens

1. **Default-arg overload ambiguity**
A wrapper can accidentally re-enter an overloaded function family when calling by name with fewer args.

2. **Fragile alias assumptions**
Rename-based chains (`..._v3_base`, `..._base_client_v1`) are not guaranteed to exist in every historical DB state.

3. **Brittle signature matching**
String-based signature detection is less reliable than catalog checks (`proname`, `pronargs`, namespace).

4. **Late dynamic invocation risk**
Dynamic SQL fallback adds parsing/syntax risk under pressure.

## Stable fix pattern

```sql
-- 1) Idempotent legacy normalization
UPDATE public.mcp_events
SET ua_family = 'codex'
WHERE ua_family = 'mcp-bridge';

-- 2) Ensure explicit 5-arg baseline exists
CREATE OR REPLACE FUNCTION public.get_admin_statistics_base_client_v1(...5 args...)
RETURNS JSONB ...;

-- 3) Recreate 6-arg wrapper and call baseline directly
CREATE OR REPLACE FUNCTION public.get_admin_statistics(...6 args...)
RETURNS JSONB ...
AS $$
BEGIN
  RETURN public.get_admin_statistics_base_client_v1(...);
END;
$$;
```

Key rule: do not let the wrapper call ambiguous `get_admin_statistics(...)` overloads as fallback.

## Verification + boundaries

Post-migration checks:

```sql
SELECT n.nspname, p.proname, p.pronargs, pg_get_function_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('get_admin_statistics','get_admin_statistics_base_client_v1','get_admin_statistics_v3_base')
ORDER BY p.proname, p.pronargs;

SELECT count(*) AS bridge_rows
FROM public.mcp_events
WHERE ua_family='mcp-bridge';
```

Expected:

- one working 6-arg wrapper
- one resolvable 5-arg baseline target
- `bridge_rows = 0`

When NOT to apply this pattern:

- if your change is body-only and no signature/default behavior changed
- if you intentionally maintain multiple public overloads and route at the API layer

Useful companion references: `[[lsn_postgres_function_overload_silent]]`

Tool-call example to discover related conventions quickly:

```text
search_lessons({
  query: "postgres create or replace overload not unique pgrst203",
  platforms: ["postgres", "supabase"],
  tier: "curated"
})
```
