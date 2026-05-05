---
id: lsn_0002_postgres_function_overload_after_replace
title: "CREATE OR REPLACE with a changed signature creates an overload, breaking PostgREST RPC calls (PGRST203)"
type: debugging_lesson
tier: community
context:
  tools: [supabase, postgrest, psql]
  languages: [sql, plpgsql]
  platforms: []
  tags: [postgres, supabase, postgrest, rpc, overloading, silent-failure]
summary: "After a CREATE OR REPLACE FUNCTION that adds (or removes) a parameter — even a DEFAULT one — Postgres keeps the old function alongside the new one as overloads. PostgREST then refuses the call with PGRST203 'Could not choose the best candidate function' and supabase.rpc() returns an error that often gets swallowed."
problem: |
  An existing RPC like `increment_counter(p_key text)` is updated via
  `CREATE OR REPLACE FUNCTION increment_counter(p_key text, p_n int DEFAULT 1)`.
  In Postgres, functions are overloaded by argument list — so the OR REPLACE
  matched no existing signature and a *second* function was created. Both
  exist in `pg_proc` simultaneously.

  PostgREST then cannot disambiguate which one to call from
  `POST /rest/v1/rpc/increment_counter` with body `{"p_key":"x"}` and returns:
  ```
  {"code":"PGRST203","message":"Could not choose the best candidate function between: ..."}
  ```
  Application code that does `const { error } = await supabase.rpc(...)` and
  only logs (or worse, ignores) `error` produces an entirely silent failure:
  zero rows written, zero exception thrown, no obvious symptom besides the
  feature being broken.
solution: |
  Drop the previous signature *explicitly* in the same migration as the
  CREATE OR REPLACE. Do not rely on REPLACE alone — it only replaces a function
  whose argument list matches exactly.

  ```sql
  DROP FUNCTION IF EXISTS public.increment_counter(text);  -- old signature
  CREATE OR REPLACE FUNCTION public.increment_counter(
    p_key text,
    p_n   int DEFAULT 1
  ) RETURNS int LANGUAGE plpgsql AS $$
  BEGIN
    -- ...
  END $$;
  ```

  Verify after migration:
  ```sql
  SELECT proname, pg_get_function_identity_arguments(oid)
  FROM pg_proc
  WHERE proname = 'increment_counter';
  -- expect exactly one row
  ```

  And test the REST path that PostgREST will actually take:
  ```bash
  curl -X POST "$SUPABASE_URL/rest/v1/rpc/increment_counter" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d '{"p_key":"x"}'
  ```
  A 200 with the new return value confirms the overload is gone.
gotchas:
  - "Catching the supabase.rpc() error and returning a default (e.g. 0) makes the failure invisible. Always surface or rethrow rpc errors during development."
  - "`CREATE OR REPLACE` does *not* replace functions whose argument list has changed. It only replaces an exact-signature match — otherwise it adds a new overload."
  - "If you cannot drop the old signature (e.g. policies depending on it), give the new function a different name (`increment_counter_v2`) instead of overloading."
  - "Adding a DEFAULT-valued parameter still counts as a different signature. Postgres function lookup is by full argument-type list, not by required-arg list."
evidence: "Reproduced on Postgres 15 (Supabase managed). PGRST203 documented at https://docs.postgrest.org/en/latest/errors.html — see the function-overloading section."
last_validated_at: "2026-05-05"
tool_versions:
  postgres: "15.x"
  postgrest: "12.x"
upvotes: 0
---

# Background

Postgres treats `f(text)` and `f(text, int)` as completely different functions,
even if you wrote them with `CREATE OR REPLACE` on the same name. PostgREST,
which exposes those functions as REST endpoints under `/rpc/<name>`, uses the
JSON body keys to pick a candidate. When two candidates exist with overlapping
parameter sets, it cannot decide and gives up with `PGRST203`.

The trap is that the second function looks "newer" than the first — your
migration just ran, the new signature is what you wrote — but the old one is
also still there, and there is no warning at create-time. You only find out at
the next REST call.

## When debugging an RPC that "does nothing"

Walk this checklist before assuming a logic bug:

1. **Is there exactly one function with that name?**
   `SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = '<name>';`
2. **Is the client-side code swallowing the error?**
   Search for `await supabase.rpc('<name>'` and confirm `error` is being checked
   and *not* defaulted away in a try/catch.
3. **Does a direct curl to `/rest/v1/rpc/<name>` reproduce?**
   PGRST203 in the body is the smoking gun for overloading.

## Why this is worth a fixed habit

The whole class of bug is invisible in unit tests if you mock the RPC layer.
It also passes `pgTAP`-style schema tests because both functions exist and
both are syntactically valid. The only place it shows up is at the
PostgREST/REST boundary, which is exactly where most Supabase apps spend
their request budget.

A one-line `DROP FUNCTION IF EXISTS old_signature;` above every signature-
changing `CREATE OR REPLACE` is the cheapest fix that exists.
