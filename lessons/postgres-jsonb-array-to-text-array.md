---
id: lsn_postgres_jsonb_array_to_text_array
title: "Cannot extract elements from a scalar (22023) — convert a JSONB array argument to TEXT[] with jsonb_array_elements_text"
type: debugging_lesson
tier: community
summary: "When a plpgsql function receives a JSONB payload whose field is an array of strings and the target column is TEXT[], a direct cast fails or mangles the value. Convert with ARRAY(SELECT jsonb_array_elements_text(payload->'field')), guarded by jsonb_typeof(...) = 'array' so absent/null/scalar inputs map cleanly to NULL instead of raising 22023 or producing an empty array."
context:
  tools: []
  languages:
    - sql
  platforms:
    - postgres
    - supabase
  tags:
    - postgres
    - jsonb
    - text-array
    - plpgsql
    - type-coercion
---

## The problem

You pass records/events as a single JSONB document into a `SECURITY DEFINER` RPC (a common
Supabase ingest pattern). One field is a JSON array of strings, and the destination column
is `TEXT[]`. Neither `(v->>'field')::text[]` nor `(v->'field')::text[]` does the right
thing: `->>` gives you the literal JSON text `["a","b"]` (a scalar string, not an array),
and casting a `jsonb` array directly to `text[]` is not a valid coercion.

## The conversion

Expand the JSONB array into a set of `text` values, then re-aggregate into a real array:

```sql
CASE
  WHEN jsonb_typeof(v_event->'lesson_ids') = 'array'
  THEN ARRAY(SELECT jsonb_array_elements_text(v_event->'lesson_ids'))
  ELSE NULL
END
```

`jsonb_array_elements_text` unnests the array as `text` rows (without surrounding quotes);
`ARRAY(SELECT ...)` collects them into a `TEXT[]`.

## Always guard with jsonb_typeof

The `CASE jsonb_typeof(...) = 'array'` wrapper is not optional polish — it makes the
expression total over the three "not actually an array" inputs a real payload throws at you:

| Input | `v->'field'` | Without guard | With guard |
|---|---|---|---|
| key absent | SQL NULL | 0 rows → `'{}'` (empty array, not NULL) | NULL |
| `"field": null` | JSONB null | empty / surprising | NULL |
| `"field": "x"` (scalar) | JSONB string | `cannot extract elements from a scalar` (22023) → aborts | NULL |
| `"field": ["a","b"]` | JSONB array | `{a,b}` | `{a,b}` |

Without the guard, a scalar value raises SQLSTATE 22023 and aborts the entire insert loop;
an absent key silently produces `'{}'` instead of NULL, which then reads back as "empty
array" rather than "not provided". The guard collapses every degenerate case to a clean
NULL.

## Reading it back

Over PostgREST a `TEXT[]` column deserializes to a JSON array of strings on the client — no
special handling needed on read, only on the write/convert side.

## When this does NOT apply

If the destination is itself a `jsonb` column, skip the conversion and store `v->'field'`
directly. The unnest-and-reaggregate is specifically for a native `TEXT[]` (or other
`<scalar>[]`) target.
