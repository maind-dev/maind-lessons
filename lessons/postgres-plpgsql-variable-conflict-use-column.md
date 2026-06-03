---
id: lsn_postgres_plpgsql_variable_conflict_use_column
title: "Fix plpgsql 'column reference is ambiguous' in RETURNS TABLE — set #variable_conflict use_column"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: []
  languages:
    - sql
  platforms:
    - postgres
    - supabase
  tags:
    - postgres
    - plpgsql
    - returns-table
    - variable-conflict
    - ambiguous-column
summary: "Columns declared in RETURNS TABLE (...) are implicit plpgsql OUT-variables. When the function body has a CTE that reuses one of those names (e.g. AS score), an unqualified reference is ambiguous ('column reference is ambiguous', SQLSTATE 42702) — even in a single RETURN QUERY. Put #variable_conflict use_column as the first body line, or qualify every reference with the CTE alias."
gotchas:
  - "RETURNS TABLE column names are implicit OUT-variables; a CTE column with the same name collides in the body."
  - "'Use a single RETURN QUERY' avoids the TEMP-table variant but NOT the CTE-vs-variable collision."
  - "#variable_conflict use_column must be the first line of the function body, before DECLARE."
last_validated_at: "2026-06-02"
---

## Symptom

A `RETURNS TABLE (...)` plpgsql function fails at runtime — even though it is a single clean `RETURN QUERY`:

```
ERROR:  column reference "score" is ambiguous
DETAIL: It could refer to either a PL/pgSQL variable or a table column.
```

(Also seen as SQLSTATE 42702.)

## Why

The columns in `RETURNS TABLE (id uuid, score real, ...)` are implicit **OUT-parameter variables**. Any name in the body that matches one of them — including a column produced by a CTE in the same `RETURN QUERY` — is ambiguous. The common advice "use a single RETURN QUERY over real tables" avoids the TEMP-table form of this bug (see Related), but NOT this one: a CTE that aliases `... AS score` collides with the `score` OUT-variable the moment you reference it unqualified.

```sql
RETURNS TABLE (id uuid, title text, score real)
...
RETURN QUERY
WITH base AS (
  SELECT t.id, t.title, ts_rank(t.tsv, websearch_to_tsquery(p_query)) AS score
  FROM things t
)
SELECT * FROM base
WHERE score > 0       -- ambiguous: OUT-variable vs CTE column
ORDER BY score DESC;
```

## Fix

Set the resolution rule once, as the first line of the function body, before `DECLARE`:

```sql
AS $$
#variable_conflict use_column
DECLARE
  ...
BEGIN
  RETURN QUERY ...
$$;
```

`use_column` makes plpgsql resolve any name matching both a variable and a column to the **column** — the cleanest fix for search/ranking functions where OUT-column names (`score`, `rank`, `updated_at`) naturally recur. The mechanical alternative is to qualify every reference with the CTE alias (`base.score`). (`error` is the default that produces the ambiguity; `use_variable` is the opposite resolution.)

## Related

- The TEMP-table / same-named-column variant and the prefix-discipline fix: [[lsn_postgres_returns_table_column_collision]].
- Verify the live function body before iterating on the bug: [[lsn_postgres_verify_live_function_body]]. Find these with `search_lessons({ query: "plpgsql RETURNS TABLE ambiguous column", platforms: ["postgres"] })`.
