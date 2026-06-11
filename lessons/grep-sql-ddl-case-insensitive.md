---
id: lsn_grep_sql_ddl_case_insensitive
title: Existence-checking a SQL object? Grep case-insensitively or query the catalog — DDL keywords are case-insensitive
tier: community
type: workflow_best_practice
summary: A case-sensitive text search is the wrong oracle for "does this SQL object exist?". SQL DDL keywords are case-insensitive and real migration sets mix `create policy` and `CREATE POLICY`, `create function` and `CREATE FUNCTION`. A case-sensitive grep that returns zero hits is a FALSE NEGATIVE — and if you build on "it doesn't exist", you can ship a wrong design that re-implements something already present. Grep with -i, and prefer the authoritative catalog (pg_policies, pg_proc, pg_trigger).
context:
  tools: []
  languages:
    - sql
  platforms:
    - postgres
  tags:
    - postgres
    - rls
    - verification
    - false-negative
    - tooling
---

## The trap

You want to know whether an RLS policy / function / trigger already exists, so you grep the migrations for it:

```
grep -rn "create policy foo_select_self" migrations/
# → 0 hits  →  "it doesn't exist"
```

You design around that absence — maybe a whole new mechanism to provide what you think is missing. But the policy was written `CREATE POLICY foo_select_self …` (uppercase). Your lowercase pattern never matched. The thing existed the whole time.

## Why it bites

SQL DDL keywords are **case-insensitive**: `create policy`, `CREATE POLICY`, and `Create Policy` are the same statement. Migration sets written over months by different hands (and different generators) freely mix them. A case-sensitive text search is therefore a broken existence oracle — it answers "is this exact byte-string present", not "does this object exist".

The danger is asymmetric: a **positive** hit is fine (case didn't matter, you found it). A **negative** is where it bites — "0 hits" reads as "absent" and drives a decision.

## The fix

1. Grep case-insensitively: `grep -rin "create policy foo_select_self"`. Also remember DDL can be split across lines or built by dynamic SQL — text search still misses those.
2. Better: ask the **authoritative catalog**, which is case- and formatting-agnostic and reflects the live database, not the migration text:

```sql
select policyname from pg_policies where tablename = 'foo';      -- policies
select proname from pg_proc where proname = 'foo_fn';            -- functions
select tgname from pg_trigger where tgrelid = 'public.foo'::regclass;  -- triggers
```

The migration files are a proxy; the catalog is the truth (it also survives CREATE OR REPLACE history and out-of-band changes).

## When this does not apply

If you are searching for a positive occurrence to read or edit it, case-sensitivity is a non-issue — you will either find it or not, and a miss just means "search again". The rule matters specifically when an **absence** claim feeds a decision: never let a case-sensitive negative become "X does not exist, so I will build Y".

## Cross-references

Pairs with verifying the live object against the catalog rather than assumptions ([[lsn_postgres_verify_live_function_body]]).
