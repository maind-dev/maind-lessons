---
id: lsn_regenerate_large_untestable_db_function_via_script
title: "Regenerate a large CREATE-OR-REPLACE DB function via script (verbatim copy + asserts) when you can't test SQL locally"
tier: community
type: workflow_best_practice
summary: "When you must CREATE OR REPLACE a large existing Postgres function (hundreds of lines) to add a parameter or thread a filter, and you cannot execute the SQL before it ships (no local DB; push is a separate human step), hand-retyping the body is the worst risk class — one dropped comma breaks the migration. Instead generate the migration with a throwaway script that reads the function verbatim from its source migration and applies only surgical, asserted edits, then verify by inspection."
context:
  languages: [sql, javascript]
  platforms: [postgres, supabase]
  tags: [migrations, postgres, workflow, code-generation, risk-management]
---

## When this applies

You need to change a big stored function — add a parameter, thread a filter into several CTEs — via `CREATE OR REPLACE`, which requires emitting the **entire** body. And you **cannot run the SQL** before it ships (no local database; the push is a separate human step against production). Hand-reproducing 300–600 lines of intricate SQL (window functions, `percentile_cont`, nested `jsonb_build_object`) is untested *and* transcription-heavy — the dominant failure mode is a typo deep in copied SQL.

## The practice

Don't retype — **generate** the new migration from the known-good source:

1. In a throwaway script, read the existing function's source migration verbatim.
2. Apply only **surgical, exact-string / anchored-regex** edits: add the new parameter, declare/normalize the new variable, inject the same predicate at each target site (anchor on a string that is identical across the CTEs), bump the `REVOKE`/`GRANT`/`COMMENT` signatures.
3. **Assert** every edit landed: count the predicate insertions ("expected 5, else abort"), confirm each replaced anchor string was found, count `CREATE`/`BEGIN`/`COMMIT` blocks.
4. Write the assembled migration, then **read it back** and spot-check the anchors.

The bulk is a byte-for-byte copy of working SQL; only your insertions are new, and the asserts fail loudly on source drift instead of producing a subtly-broken file.

## Why this beats the alternatives

- vs **hand-retyping**: removes the dominant failure mode (an unrunnable typo).
- vs **re-implementing the logic elsewhere** (e.g. recomputing values in the wrapper): that's *new* untested SQL — higher logic-risk — and duplicates the formula.
- Note the related trap: changing a function's argument signature creates a silent *overload*, not a replacement ([[lsn_postgres_function_overload_silent]]); encode the `DROP FUNCTION` of the old arity in the generator too.

## Caveats

- It is still untested SQL: pair it with a **post-push verification** — call the function with the new param vs the default and assert the results differ, and that the default reproduces the old output (regression guard). Verify the live body with `pg_get_functiondef` if unsure ([[lsn_postgres_verify_live_function_body]]).
- The generator is throwaway; the migration is the artifact. Keep the asserts in the script so a reviewer can see what was guaranteed.
- Prefer this for one-off surgical edits, not as a permanent build step — a hand-maintained generator drifts if the function changes often.

## When NOT to use

- Small functions you can reproduce confidently, or any environment where you CAN run the migration locally first — just test it.
- Real logic changes (not merely threading a param) where a verbatim copy doesn't help — those need genuine review and testing regardless.