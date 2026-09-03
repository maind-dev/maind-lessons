---
id: lsn_postgres_aggregate_row_defeats_where_gate
title: "Diagnose a gate that never denies — an ungrouped aggregate returns a row even when its WHERE is false"
type: debugging_lesson
tier: community
summary: "An ungrouped aggregate returns exactly one row no matter what the WHERE clause does. Putting an authorization check there cannot suppress that row; it only nulls the values, so an unauthorized caller receives `{max: null, count: 0}` — which reads as a legitimate empty state, not as a refusal. Gate before the aggregate (plpgsql `RETURN`, or an outer WHERE over the subquery), and assert row COUNT in the test, never row content."
context:
  languages: [sql]
  platforms: [postgres, supabase]
  tags: [postgres, aggregate, security-definer, authorization, silent-bug, rls, evaluation-order]
---

## The shape that traps you

A `SECURITY DEFINER` function returns a status summary and gates it on a role check:

```sql
CREATE FUNCTION public.get_thing_status()
RETURNS TABLE (last_seen_at timestamptz, count_24h int)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT max(e.at),
         count(*) FILTER (WHERE e.at > now() - interval '24 hours')::int
    FROM public.events e
   WHERE e.org_id = public.caller_org()
     AND public.caller_is_admin();     -- ← the gate
$$;
```

It reviews cleanly. The gate is right there in the WHERE clause, next to the tenant filter, and the tenant filter demonstrably works.

It does not gate. A non-admin gets a row.

## Why: an ungrouped aggregate always produces exactly one row

`WHERE` selects the input rows. An aggregate with no `GROUP BY` then folds whatever survives — **including nothing at all** — into a single output row. Zero input rows is not zero output rows; it is one row of `NULL` and `0`.

Measured on PostgreSQL 17:

| Query | Rows |
|---|---|
| `SELECT max(x) FROM t WHERE false` | **1** — contents `NULL` |
| `SELECT max(x), count(*) FROM t WHERE false` | **1** — contents `NULL, 0` |
| `SELECT max(x) FROM t WHERE false GROUP BY owner` | 0 |
| `SELECT agg.* FROM (SELECT max(x) FROM t) agg WHERE false` | 0 |

Reproduce it in ten seconds:

```sql
CREATE TEMP TABLE t(x int, owner text);
INSERT INTO t VALUES (1,'a'),(2,'a'),(3,'b');
SELECT count(*) FROM (SELECT max(x) FROM t WHERE false) q;                -- 1
SELECT count(*) FROM (SELECT max(x) FROM t WHERE false GROUP BY owner) q; -- 0
```

The `GROUP BY` row is why the mental model survives so long. Grouped aggregates behave the way people expect, so a codebase can hold several "correct" examples that quietly teach the wrong rule.

### Why this particular failure hides

Most authorization bugs are loud: the caller gets data they should not have, and it looks like data. This one hands them `{last_seen_at: null, count_24h: 0}` — **indistinguishable from a legitimate empty state**.

On a status or telemetry surface that is the worst possible payload. "Nothing has arrived yet" is a completely normal thing for such a page to say. Nobody files a bug about it, because nothing looks wrong. The gate is decorative, and everyone who reads the function believes it is load-bearing.

The leak is small in the ungrouped case — one aggregate row, no per-row detail. It stops being small the moment someone adds a column that is not an aggregate over the gated set, or turns the function into a per-row listing, because the gate they are extending never worked.

## The fix: gate before the aggregate, not inside it

**Preferred — plpgsql with an explicit early return.** The gate is a statement, not a predicate, so it cannot be folded into the aggregate:

```sql
CREATE FUNCTION public.get_thing_status()
RETURNS TABLE (last_seen_at timestamptz, count_24h int)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE v_org uuid := public.caller_org();
BEGIN
  IF v_org IS NULL OR NOT public.caller_is_admin() THEN
    RETURN;                       -- zero rows, unambiguously
  END IF;

  RETURN QUERY
  SELECT max(e.at),
         count(*) FILTER (WHERE e.at > now() - interval '24 hours')::int
    FROM public.events e
   WHERE e.org_id = v_org;
END $$;
```

**Also correct — an outer WHERE over the aggregate subquery**, if you want to stay in `LANGUAGE sql`:

```sql
SELECT agg.* FROM (SELECT max(e.at) ... FROM public.events e WHERE e.org_id = ...) agg
 WHERE public.caller_is_admin();
```

This works, but it computes the aggregate and then discards it, and a reader skimming the function sees a gate at the bottom rather than at the top. Prefer it only when plpgsql is genuinely unavailable.

**Not a fix:** adding `GROUP BY` to make the row disappear. It happens to produce zero rows here, but you have expressed an access rule as a grouping accident — the next person who removes the grouping for a legitimate reason reopens the hole with no signal.

## Verification: assert the row COUNT, never the row content

This is the part most tests get wrong, and it is what makes the bug survive review:

```sql
-- WRONG: passes against the broken version too. The broken version
-- returns exactly these values.
SELECT * INTO v_row FROM public.get_thing_status();
ASSERT v_row.count_24h = 0, 'a non-admin must not see counts';

-- RIGHT: the only assertion that distinguishes "refused" from "empty".
SELECT count(*) INTO v_cnt FROM public.get_thing_status();
ASSERT v_cnt = 0, 'a non-admin must get ZERO rows, not an empty one';
```

Exercise it as the real role — called as the migration superuser, `auth.uid()` is NULL and a green run proves nothing:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<non-admin-uuid>","role":"authenticated"}';
SELECT count(*) FROM public.get_thing_status();   -- must be 0
ROLLBACK;
```

Then run the assertion **against a deliberately broken copy** of the function. An access-control test that has never been shown to fail is a claim, not a check — and this is a failure mode where the passing and failing outputs look nearly identical.

## When this does NOT apply

- **The aggregate is grouped.** `GROUP BY` over an empty input yields no rows, so a WHERE-clause gate does suppress the output. It is still worth hoisting the gate for legibility, but there is no leak.
- **The query returns rows rather than folding them.** A plain `SELECT ... FROM t WHERE gate` returns nothing when the gate is false; that is the ordinary, safe case, and it is why the aggregate exception surprises people.
- **The empty-but-present row is the intended contract.** A public counter that should answer `0` to everyone is not gated at all — make that explicit in a comment, or the next reader will "fix" it.
- **The gate lives elsewhere and is enforced** — RLS on the base table with a `SECURITY INVOKER` function, or a check in the calling layer that the caller cannot skip. Note that DEFINER bypasses RLS, so a DEFINER function has no such fallback.

## Related

Retrieve this from the symptom, before writing the function rather than after:

```js
search_lessons({
  query: "security definer aggregate returns row gate where clause not enforced",
  platforms: ["postgres"],
});
get_lesson({ id: "lsn_postgres_aggregate_row_defeats_where_gate" });
```

- [[lsn_postgres_window_function_after_where_filter]] — the same family, one clause over: window functions run *after* `WHERE`, so they see the filtered set rather than the table. Both entries say the same thing in different words — a predicate's effect depends on where in the pipeline it lands.
- [[lsn_rls_fails_for_caller_knows_secret]] — the other direction of misplaced gate: a rule that RLS structurally cannot express, pushed into RLS anyway.
- [[lsn_postgres_security_definer_auth_uid_null]] — read before relying on any `auth.uid()`-based gate inside a DEFINER function.