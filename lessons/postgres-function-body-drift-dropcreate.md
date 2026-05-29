---
id: lsn_postgres_function_body_drift_dropcreate
title: "Diagnose silent body-drift after a Postgres function redefinition — DROP+CREATE can revert behavioral fixes invisibly"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: []
  languages: [sql]
  platforms: [postgres, supabase]
  tags: [postgres, supabase, migrations, regression, refactor, drift, defense-in-depth, security-definer]
summary: "When a later migration `DROP FUNCTION + CREATE OR REPLACE FUNCTION` adds new return fields or args, it's easy to silently drop a behavioral fix from an earlier migration (a helper-call, a SECURITY DEFINER setting, a SET search_path). The signature changes, code review focuses on the new fields, and the lost call surfaces days later as a user-visible regression. Pre-empt with a substring-based drift guard."
problem: |
  A previous migration fixed a behavioral bug by replacing
  `users.plan` with `get_effective_plan(uid)` inside a RPC body so
  that admin-overrides are honored. Months later, a separate
  migration `DROP + CREATE OR REPLACE` re-defined the same RPC to
  add two new return columns (`org_id`, `org_role`). The author
  copied the latest source-of-truth body, but reverted the
  helper-call to the original `u.plan` JOIN — invisible during
  code review because the diff frames the change as "added two
  return columns", not "behavioral revert".

  Symptoms:
  - DB-level invariant is still correct
    (`SELECT get_effective_plan(uid)` returns the right value).
  - The API/MCP/Edge-Function caller sees the regressed value
    because the RPC body now reads the unguarded column directly.
  - The bug is typecheck-invisible (SQL), linter-invisible
    (sqlfluff doesn't understand domain semantics), and only
    surfaces when a user reports "I have entitlement X but the
    app says Y".

  Root cause class:
  - DROP + CREATE-style refactors of dollar-quoted PL/pgSQL
    bodies have no structural protection against losing
    behaviors that don't appear in the function's RETURNS,
    args, or comment.
  - Code review primes on the visible signature delta and skips
    line-by-line body comparison.
  - The fix that lives inside the body has no representation in
    the SQL grammar that a linter could check.
solution: |
  Three-layer defense-in-depth against body drift across RPC
  redefinitions. Each layer is independently useful; together
  they cover the common workflow failures.

  **Layer 1 — Static repo linter (a Node script + manifest).**

  Manifest names guarded functions + substrings the body MUST
  contain:

  ```json
  // scripts/rpc-drift-manifest.json
  {
    "guards": [
      {
        "function": "verify_api_key",
        "required_substrings": ["get_effective_plan"],
        "reason": "Override path: plan lookup MUST call get_effective_plan(uid).",
        "regression_history": [
          { "regression_in": "20260530000002_…", "detected_at": "2026-05-19" }
        ]
      }
    ]
  }
  ```

  The linter walks `supabase/migrations/*.sql` chronologically
  (filename = timestamp), finds the LAST file that contains
  `CREATE [OR REPLACE] FUNCTION (public.)?<name>(...)`,
  extracts the block up to `$$;`, strips SQL line-comments
  (`--`), and asserts every `required_substring` is present.
  Exit 1 with diagnostic on drift, exit 0 otherwise. Runs
  in <100 ms over ~100 migrations — fast enough for pre-commit.

  **Layer 2 — Pre-commit hook that runs Layer 1 when a
  migration is staged.**

  ```bash
  maind_mig=$(git diff --cached --name-only --diff-filter=ACMR \
    | grep -E "^supabase/migrations/.*\.sql$" || true)
  if [ -n "$maind_mig" ]; then
    node scripts/check-rpc-drift.mjs || exit 1
  fi
  ```

  Bypass via `SKIP_DRIFT_CHECK=1` for emergencies; document it
  so the bypass is auditable.

  **Layer 3 — Intra-migration `DO`-block self-assertion.**

  Every migration that redefines a guarded function should end
  with a self-check that fires when the migration is applied —
  catches the case where someone hand-edits a migration after
  the pre-commit hook and pushes directly with `db push`:

  ```sql
  DO $assert$
  DECLARE v_def TEXT;
  BEGIN
    v_def := pg_get_functiondef('public.verify_api_key(text)'::regprocedure);
    IF v_def NOT ILIKE '%get_effective_plan%' THEN
      RAISE EXCEPTION
        'RPC Drift-Guard: verify_api_key MUST call get_effective_plan. '
        'Add the call or update the drift manifest with rationale.'
        USING ERRCODE = 'P0001';
    END IF;
  END
  $assert$;
  ```

  The `RAISE EXCEPTION` aborts the transaction wrapping the
  migration, so the Cloud DB never sees the regressed function
  body. P0001 is the standard plpgsql user-raised errcode.

  Why three layers (and not just one):
  - Layer 1 is dev-time feedback while iterating.
  - Layer 2 enforces Layer 1 across the team.
  - Layer 3 is the last line of defense — catches direct
    `supabase db push` against hand-edited migrations, Studio
    SQL applies, and `--no-verify` commits.

  Manifest entries should include `regression_history` so a
  future maintainer can see WHY the guard exists and not
  cargo-cult-remove it during cleanup.
gotchas:
  - "Substring match is textual, not semantic. `IF false THEN PERFORM get_effective_plan(uid); END IF;` would falsely satisfy the guard. Counter: pair the static guard with a smoke-test in the migration's verification comment block (manual but visible)."
  - "If your guarded function has overloads, the linter must match the signature, not just the name — otherwise the wrong overload's body gets checked. The first version of this guard intentionally matches name-only because none of the initially-guarded RPCs had overloads. Plan the upgrade when introducing one."
  - "The intra-migration `DO`-block uses `pg_get_functiondef`, which requires the function to exist at the time the block runs. Place it AFTER the `CREATE OR REPLACE` in the same migration; otherwise it asserts against the pre-migration body and is misleading."
  - "Layer 2 (pre-commit) can be bypassed with `--no-verify`. Layer 3 is the only one that survives that bypass — don't skip it because Layer 2 'feels enough'. Defense-in-depth means redundancy is the point."
  - "Don't add the guard for every RPC body invariant — manifest pollution defeats the purpose. Add a guard when (a) the substring represents a non-obvious behavioral fix that survived a code review failure once, OR (b) the invariant is security-load-bearing (e.g. `SET search_path = public` on SECURITY DEFINER). Document the reason inline."
last_validated_at: "2026-05-19"
---

## When to reach for this convention

Call `search_lessons({platforms: ["postgres", "supabase"], tags: ["migrations", "drift"]})` when:

- You're about to write a `DROP FUNCTION + CREATE OR REPLACE FUNCTION` migration for an RPC that already exists. Cross-check whether an earlier migration added behavioral fixes (look for `get_effective_plan`-style helper calls, `SECURITY DEFINER`, `SET search_path`, explicit cast guards) before pasting the new body.
- A user reports the API returning a different value than the DB-internal invariant. Run `get_lesson({id: "lsn_postgres_function_body_drift_dropcreate"})` and then `SELECT pg_get_functiondef('public.<fn>(<sig>)'::regprocedure)` to compare the live body against your latest source-of-truth migration.

## Verification

After applying any guarded migration, both checks below MUST return the expected result. Bake them into the migration's trailing `-- Verification` comment block so the next maintainer can re-run them:

```sql
-- 1. Static drift check — every required substring still present
SELECT pg_get_functiondef('public.verify_api_key(text)'::regprocedure)
  ILIKE '%get_effective_plan%';
-- expected: t

-- 2. Behavioral E2E — Override is honored end-to-end
INSERT INTO public.plan_overrides (user_id, override_tier, reason, granted_by)
VALUES ('<test-uid>', 'enterprise', 'drift-guard test', '<admin-uid>');

SELECT plan FROM public.verify_api_key(
  'mnd_xxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
);
-- expected: 'enterprise', not the underlying users.plan value
```

Run the static check in CI/pre-commit alongside the live-DB E2E check post-deploy. If only the static one passes, your manifest is consistent but you might still ship a runtime regression in unrelated code (caching layer, mis-deployed app). If only the E2E passes, your manifest is missing a guard — add it.

## Why this is its own convention (not a duplicate)

This sits next to two existing curated practices but covers a distinct failure mode:

- [[lsn_postgres_function_overload_silent]] — `CREATE OR REPLACE` with a CHANGED signature creates a silent overload. That's a schema-shape problem. This convention is about UNCHANGED signature with a DRIFTED body — review-blindness, not Postgres semantics.

- [[lsn_postgres_verify_live_function_body]] — using `pg_get_functiondef` to debug an active RPC bug. This convention uses the same function as a build-time invariant check, not as a reactive diagnostic.

## When to skip this pattern

- One-off functions that aren't on critical paths and never get redefined. The manifest is overhead, the regression risk is negligible.
- Functions where the invariant is structurally enforced elsewhere — e.g. `SECURITY DEFINER` is checked by RLS policies on the underlying table, so dropping it manifests immediately as a permission error, not a silent bug. Drift guards are most valuable for silent-divergence patterns.

## Generalization beyond Postgres

The same shape applies to any DDL-style "drop + create" refactor in stores where the body holds behaviorally-load-bearing code:

- Cloudflare Worker scripts re-uploaded via `wrangler deploy`.
- AWS Lambda Layer re-publishes that revert a workaround.
- BigQuery routines, Snowflake stored procedures.

The pattern: when a refactor's diff is dominated by signature or interface changes, the body is where the bug hides. A substring-based guard with a documented manifest is the cheapest test that catches it.
