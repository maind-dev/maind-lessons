---
id: lsn_postgres_ts_rank_nonmatch_nonzero
title: "Diagnose a relevance filter that matches every row: Postgres ts_rank returns ~1e-20 (not 0) for non-matching queries"
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
    - full-text-search
    - ts_rank
    - ranking
    - relevance
summary: "ts_rank(tsv, query) does not return 0 for rows the query does not match — it returns a tiny positive floor (about 1e-20). A relevance filter written as WHERE ts_rank(...) > 0 therefore passes EVERY row. Gate membership on the @@ match operator; use ts_rank only to order rows that already matched."
gotchas:
  - "A relevance filter using ts_rank > 0 (or >= 0) is always wrong — it matches every row."
  - "Comparing ts_rank against a threshold to mean 'matched' — use the @@ operator for membership instead."
  - "Summing the text score with other signals (freshness, tags) then filtering on the sum > 0 — a non-text term alone can qualify a non-matching row."
last_validated_at: "2026-06-02"
---

## Symptom

A keyword-search RPC that should return only matching rows returns *everything*. The relevance gate looks correct:

```sql
WHERE ts_rank(
  to_tsvector('simple', title || ' ' || body),
  websearch_to_tsquery('simple', p_query)
) > 0
```

Yet rows that share no lexeme with the query still come back.

## Why

`ts_rank` is a *ranking* function, not a *match* predicate. For a row whose `tsvector` does not match the `tsquery`, it does not return `0` — it returns a tiny positive floor (observed `1e-20`). So `ts_rank(...) > 0` is effectively `TRUE` for every row.

Reproduce:

```sql
SELECT ts_rank(
  to_tsvector('simple', 'alpha beta gamma'),
  websearch_to_tsquery('simple', 'zzz nomatch')
);
-- => 1e-20   (NOT 0)
```

## Fix

Separate "does it match" from "how well does it rank". Gate membership on the `@@` operator; use `ts_rank` only to order the survivors.

```sql
WITH base AS (
  SELECT t.*,
    to_tsvector('simple', t.title || ' ' || t.body)
      @@ websearch_to_tsquery('simple', p_query) AS is_match,
    ts_rank(
      to_tsvector('simple', t.title || ' ' || t.body),
      websearch_to_tsquery('simple', p_query)
    ) AS rank
  FROM things t
)
SELECT * FROM base
WHERE is_match              -- membership: @@ , never rank > 0
ORDER BY rank DESC          -- ranking: ts_rank, only for matched rows
LIMIT p_limit;
```

Prefer `websearch_to_tsquery` over `to_tsquery` for user-supplied text: it never raises on arbitrary input (stray `&`, quotes, operators), so a malformed query cannot make the RPC error out.

## When you blend scores

If the text score is one term in a weighted sum (tag overlap + freshness + text), keep the *qualifier* on an explicit match flag (`@@` and/or tag membership) and add `ts_rank` only as a score term. Otherwise a non-matching row with a freshness boost still leaks through a `score > 0` filter — the same bug, one layer up.

## When this does not apply

If you already gate on `@@` membership and use `ts_rank` purely for `ORDER BY`, you are fine — the floor value only matters when `ts_rank` is used as a *filter*. Note `ts_rank_cd` has the same non-zero-floor behavior, so the rule is identical for it.

## Related

- For the broader "rank and pick top-N server-side, never raw-select" pattern, see [[lsn_supabase_postgrest_row_limit_truncation]].
- Building the search as a `RETURNS TABLE` RPC? Watch the OUT-column/variable collision in [[lsn_postgres_returns_table_column_collision]].
- Surface this from a session with `search_lessons({ query: "postgres full text search relevance gate", platforms: ["postgres"] })`.
