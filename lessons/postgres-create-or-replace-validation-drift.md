---
id: lsn_postgres_create_or_replace_validation_drift
title: "Re-CREATEing a large SECURITY DEFINER function to add one check risks silently dropping an existing validation block"
type: workflow_best_practice
tier: community
summary: "Recreating a large hand-maintained SECURITY DEFINER function via CREATE OR REPLACE (same signature) to add one check means re-typing the whole body — easy to omit an existing security-relevant validation block. It compiles and deploys cleanly; the gap surfaces later as a bypass. Mitigate: avoid redefining for non-critical changes; else copy the body verbatim, add a drift-guard DO-block that asserts required markers, and make the gate fail-safe so a lost check cannot grant more access."
gotchas:
  - "Distinct from the signature-overload trap (changed args create two overloads → PGRST203). Here the signature is identical, so it IS a real replacement — but the body is whatever you re-typed."
  - "A bare CREATE OR REPLACE for a body change is fine in principle; the risk is the HUMAN reproduction of a 200+ line body, where one validation IF gets lost with no error."
  - "Add a trailing DO-block that runs pg_get_functiondef(...) ILIKE '%marker%' and RAISEs if a required clause is missing — the migration then fails loudly on drift."
  - "Design the access decision to fail toward LESS access, so even a dropped validation cannot widen the gate (resolver falls back to the stricter prior behaviour on missing/invalid input)."
context:
  languages: [sql]
  platforms: [postgres, supabase]
  tags: [postgres, security-definer, create-or-replace, migrations, fail-safe]
---

## The failure mode

A migration needs to add a small check to a large `SECURITY DEFINER` function. Because Postgres has no "patch the body" operation, you `CREATE OR REPLACE FUNCTION ...` with the **entire** body re-typed. The signature is unchanged, so this is a genuine replacement (not an overload). But the new body is exactly what you wrote — if you forget to re-include an existing `IF ... RAISE EXCEPTION` validation block, it is simply gone. No error, no warning; typecheck and migration both pass.

If the dropped block was security-relevant (an input-type guard, an authz check), the result is a silent bypass that surfaces only when malformed input reaches the now-unguarded path.

## Why it bites repeatedly

The same function gets re-CREATEd across many migrations over time. Each re-CREATE is another chance to drop a clause an earlier migration added. The drift is invisible in review because the diff reads as "new function" vs "new function", not "block removed".

## Mitigations (in order of preference)

1. **Don't redefine for non-critical additions.** If the change is a nice-to-have, weigh it against the reproduction risk. Sometimes the safest change is no change.
2. **Copy the latest body verbatim**, then insert the new clause — never re-type from memory.
3. **Drift-guard DO-block.** After the CREATE, assert the body still contains every required marker:
   ```sql
   DO $assert$
   DECLARE v_def text;
   BEGIN
     v_def := pg_get_functiondef('public.my_fn(int)'::regprocedure);
     IF v_def NOT ILIKE '%required_marker%' THEN
       RAISE EXCEPTION 'drift-guard: my_fn lost required_marker';
     END IF;
   END $assert$;
   ```
   The migration now fails loudly if a clause was dropped.
4. **Fail-safe the gate.** Make the consuming code fall back to the stricter prior behaviour on missing/invalid input, so a lost check can never grant MORE than before.

## When this does not apply

If the function is small enough to re-read in full at a glance, the drift risk is low. And if your change alters the signature, you must `DROP` + `CREATE` anyway — that is the different trap in [[lsn_postgres_function_overload_silent]]. This lesson targets large, hand-maintained bodies that accrue validation over many migrations.

## Related

- [[lsn_postgres_function_overload_silent]] — the sibling trap: a *changed signature* silently creates an overload instead of replacing.
- [[lsn_postgres_verify_live_function_body]] — verify the deployed body with `pg_get_functiondef` before assuming a migration landed.
- Companion pattern `lsn_failsafe_default_when_gate_flag_missing`: a fail-safe gate makes a dropped check non-harmful.

## Generalization

Applies to any Postgres project with large, hand-maintained `SECURITY DEFINER` functions that accrue validation over time — authz RPCs, plan/entitlement resolvers, webhook handlers. The drift-guard + fail-safe pair turns a silent-bypass risk into a loud migration failure.
