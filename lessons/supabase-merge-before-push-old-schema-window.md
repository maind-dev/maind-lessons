---
id: lsn_supabase_merge_before_push_old_schema_window
title: Before merging a PR with a Supabase migration, cut it so the deployed code survives the old schema until db push
type: workflow_best_practice
tier: community
summary: "When main deploys on merge and cloud migrations are pushed afterwards, new code runs against the old schema in between. The order cannot flip: the CLI link sits in the gitignored supabase/.temp, so a feature worktree can never db push --linked. Cut such PRs so the code tolerates the old schema: additive migrations and same-signature redefinitions do, code needing a brand-new column does not. When in doubt, ship two PRs."
context:
  tools: [supabase-cli, git]
  languages: [sql]
  platforms: [supabase, vercel]
  tags: [migrations, deploy-order, worktree, expand-contract, zero-downtime]
---

## The window you cannot avoid

A common setup: the hosting platform deploys `main` on every merge, and cloud
migrations are applied by a person running `supabase db push` from the main
checkout. Between the merge and that push, the **new code is live against the
old database**. Minutes in the good case, hours when the push waits for
someone.

The instinct is to flip the order: push the migration first, then merge the
code, so the database is always ahead. In a worktree-per-feature setup that
order is not available:

- `supabase link` writes the project reference to `supabase/.temp/`
  (`project-ref`, `linked-project.json`), and the default `supabase/.gitignore`
  ignores `.temp`.
- A feature worktree is a fresh checkout, so it **never** carries that file.
  `db push --linked` fails there.
- The migration therefore has to be on `main`, in the linked main checkout,
  before it can be pushed at all.

There is only one order, so the window is a given. What you choose is how the
PR is cut.

## Cut the PR so the code survives the old schema

Survives the window:

- **Additive migrations** — a new table, a new nullable column, a new index or
  policy that no running code path depends on yet.
- **Function redefinitions with an unchanged signature** — callers keep
  working against either body.

Breaks during the window:

- Code that **reads or writes a column, table or RPC that the same PR
  creates** — every request on that path fails until the push.
- A **changed function signature**: callers send the new arguments to the old
  function and get `function does not exist` (PostgREST: `PGRST202`).
- Destructive changes (drop, rename, `NOT NULL` without a default) together
  with the code that stops using the old shape.

## When in doubt: two PRs

1. PR 1: the migration only, written additively. Merge it, run `db push` from
   the main checkout, and verify the object exists in the cloud.
2. PR 2: the code that uses it.

This is the expand–contract pattern seen from the deploy order. A later
cleanup (dropping what PR 2 no longer uses) is a third PR, after the code
that stopped using it is live.

## Verification

After the push, before merging the dependent code:

```sql
-- the column / function the next PR relies on exists in the cloud
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = '<table>' AND column_name = '<col>';
SELECT to_regprocedure('public.<fn>(<arg types>)');   -- non-null
```

## When this does NOT apply

- **Migrations run in the deploy pipeline** (CI applies them before the new
  code goes live): the database is ahead by construction, and there is no
  window.
- **No deploy on merge** (manual releases): push the migration, then release
  the code that needs it.
- **A linked checkout per branch** (you link every worktree by hand): you can
  push before merging, but you then apply unmerged schema to production, which
  is a different risk.

## Related

- [[lsn_supabase_shared_local_stack_sibling_worktree_migrations]] — the local
  counterpart: worktrees share one local stack and its ledger.
- [[lsn_postgres_function_overload_silent]] — why a changed signature is not a
  redefinition but a second function.

```js
search_lessons({ query: "migration deploy order merge before db push old schema window", platforms: ["supabase"] })
```
