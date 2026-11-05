---
id: lsn_supabase_function_timeout_postgrest_only
title: Diagnose a function-level statement_timeout that looks useless in psql — PostgREST hoists it, direct and nested calls do not
type: debugging_lesson
tier: community
context:
  tools: [postgrest, psql]
  languages: [sql]
  platforms: [supabase, postgres]
  tags: [statement-timeout, postgrest, rpc, testing, false-negative]
summary: "`ALTER FUNCTION ... SET statement_timeout` (or a SET clause in CREATE FUNCTION) does extend the role limit for an RPC called through PostgREST, because PostgREST hoists the setting into the transaction before the call. The same function called from psql, a migration, a test script or another SQL function runs under the caller's limit: the timer is armed when the outer statement starts. Testing the override in psql therefore shows it as useless when it works in production."
problem: |
  A team checks whether the per-function override for Supabase's 8-second
  `authenticated` timeout really works. In psql, with an outer
  `statement_timeout` of 1 s, a function declaring `SET statement_timeout = '5s'`
  that sleeps 2 s is cancelled with 57014 — for SQL and PL/pgSQL alike. The
  conclusion "function-level timeouts are no-ops, every RPC runs under 8 s" is
  wrong for the Data API path, and acting on it (dropping hundreds of overrides,
  raising the role limit globally) would change production behaviour for no reason.
solution: |
  1. Test the override through the path production uses: the REST endpoint
     `/rest/v1/rpc/<fn>` with a JWT of the role that has the limit.
  2. Minimal probe (local stack, role `anon` with its 3 s limit): three functions
     that sleep 4 s — one without SET, one `SET statement_timeout = '6s'` in SQL,
     one in PL/pgSQL. Through PostgREST: the first returns 57014 after 3 s, the
     other two return normally.
  3. Know where the override does NOT apply:
     - direct connections (psql, migrations, test scripts, cron jobs): the
       statement timer is armed at statement start with the session value; a
       SET clause on the function changes the GUC but does not re-arm the timer;
     - a function called from inside another SQL function: only the top-level
       RPC's setting is hoisted;
     - plain table reads through PostgREST (`.from(...)`): there is no function
       to carry a setting, so the role limit applies.
  4. When a timeout fires on a page, check which read it was: an RPC with an
     override had its own budget; plain table reads had the role's.
gotchas:
  - "A green override test in psql is impossible and a red one proves nothing — the psql path never sees the override."
  - "PostgREST controls which settings it hoists (`db-hoisted-tx-settings`; default includes statement_timeout). A deployment that narrowed this list loses the override."
  - "service_role has no timeout at all, so testing as service_role says nothing about the authenticated limit."
evidence: "Reproduced 2026-10-27 on PostgreSQL 17.6 with PostgREST v16.1 (Supabase local stack): psql cancels the overriding function at the outer limit; the same functions through /rest/v1/rpc honour the function-level value, with a no-override control failing as expected."
last_validated_at: "2026-10-27"
tool_versions:
  postgrest: "16.1"
  postgres: "17.6"
---
## Verify through the REST path, not psql

```bash
# Local stack: anon has statement_timeout=3s
for f in probe_plain probe_set probe_plpgsql; do
  curl -s -X POST "$API_URL/rest/v1/rpc/$f" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" -d '{}'
done
# probe_plain  -> {"code":"57014", ...}
# probe_set    -> "ok"   (SET statement_timeout = '6s', sleeps 4 s)
# probe_plpgsql-> "ok"
```

```sql
-- The psql path, for contrast: cancelled although the function says 5 s
CREATE FUNCTION pg_temp.slow() RETURNS int LANGUAGE sql
  SET statement_timeout = '5s' AS $$ SELECT 1 FROM pg_sleep(2) $$;
SET statement_timeout = '1s';
SELECT pg_temp.slow();  -- ERROR: canceling statement due to statement timeout
```

## When this does NOT apply

- The function is never called through PostgREST (only from cron, triggers or other functions): there the override has no effect, and a long job needs a session-level setting or a different role.
- You need a longer limit for plain table reads: move the read into an RPC or raise the role limit; a function setting cannot help.

Related: [[lsn_supabase_authenticated_statement_timeout]] (the 8 s role limit and when an override is the wrong fix), [[lsn_postgres_function_overload_silent]] (changing the signature while adding a parameter to such an RPC).

Find it from the symptom:

```js
search_lessons({ query: "function statement_timeout override ignored psql postgrest 57014", platforms: ["supabase", "postgres"] })
```
