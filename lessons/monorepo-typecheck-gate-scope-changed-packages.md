---
id: lsn_monorepo_typecheck_gate_scope_changed_packages
title: "Scope a monorepo typecheck gate to changed packages + dependents — recursive `pnpm -r` blocks on code outside the diff"
type: workflow_best_practice
tier: community
summary: "A commit/sync gate running `pnpm -r typecheck` over ALL workspace packages fails on packages the author never touched — usually a freshly-pulled package whose node_modules was never installed (TS2307 'Cannot find module node:*'). Scope the gate to packages with staged .ts/.tsx files, expanded to dependents via `pnpm --filter \"...{./path}\"`, so shared-package changes still check consumers but unrelated packages never block a clean commit."
context:
  tools: [claude-code, cursor, windsurf]
  languages: [typescript, bash, python]
  platforms: [node]
  tags: [pnpm, monorepo, typecheck, pre-commit-gate, sync-script, workspace]
---

## The failure this prevents

A pre-commit or sync-script typecheck gate wired as `pnpm -r typecheck` (recursive over every workspace package) blocks a commit whose diff is completely clean, because some *other* package in the monorepo doesn't typecheck. The most common trigger is a `git pull` that brought in a new workspace package before `pnpm install` ran for it:

| Symptom | Cause |
|---|---|
| Gate fails in a package NOT in your diff | `pnpm -r` checks all packages, not just changed ones |
| `error TS2307: Cannot find module 'node:child_process'` / `'node:crypto'` | Freshly-pulled package, `node_modules` (incl. `@types/node`) never installed |
| `error TS2580: Cannot find name 'process'` | Same — missing `@types/node` in that package |
| `WARN Local package.json exists, but node_modules missing` | pnpm confirming the package was never installed locally |
| `Scope: 21 of 22 workspace projects` then one fails | Recursive run; the one failure is unrelated to your work |

Real instance (2026-07-05): a pull merged two new packages (`packages/project-key`, `packages/code-index`) from parallel PRs. Their deps were never installed locally. A completely unrelated dashboard commit was blocked because `pnpm -r typecheck` also visited `project-key`, which failed with the four `@types/node` errors above. The author's diff was green.

This is the same class as [[lsn_parallel_sessions_first_ask]] — tooling reacting to state the author didn't create — applied to the CI-gate layer.

## The fix: scope to changed packages, expand to dependents

Map the staged `.ts/.tsx` files to the workspace packages that contain them (walk up to the nearest `package.json`), then typecheck only those — but expand each with pnpm's **dependents** selector so a change to a shared package still validates its consumers:

```bash
# ...{path} = the package at path PLUS everything that depends on it
pnpm --filter "...{./apps/dashboard}" --filter "...{./packages/schemas}" \
     run --if-present typecheck
# → Scope: 2 of 22 workspace projects (+ any dependents of schemas)
```

Key pieces:

- **`...{./path}`** (leading `...`) selects the package *and its dependents*. A leaf app has no dependents → just itself. A shared `packages/types` → itself + every consumer, so a breaking type change is still caught. This preserves the only real safety the recursive run gave you.
- **`--if-present`** skips packages that have no `typecheck` script, matching `pnpm -r`'s silent-skip behavior. Without it, a matched dependent lacking the script errors.
- **Fallback to `pnpm -r typecheck`** if any staged file can't be mapped to a package. Never make the gate *less* strict than before — over-check on ambiguity, never under-check.

Mapping a file to its package (pseudocode):

```
for each staged .ts/.tsx file (repo-relative):
    strip the monorepo prefix
    walk directories upward from the file until a package.json is found
      (bounded by the monorepo root, which has one too)
    record that directory, relative to the monorepo root
collect the unique set → build one --filter "...{./dir}" per package
```

## Why not just fix the uninstalled package?

`pnpm install` fixes the immediate instance, but the gate will keep firing on the next unrelated package that a teammate or a parallel agent-session pulls in before you install it. The scoping fix removes the entire class: the gate only ever fails on packages your change actually reaches. Do both — install to unblock now, scope to stop it recurring.

## When this does NOT apply

- **Single-package repos** — there's nothing to scope; `tsc --noEmit` is already minimal.
- **You WANT a full-workspace gate as a release/CI check** — a nightly or pre-deploy job SHOULD run `pnpm -r typecheck` (plus a real build) to catch integration drift. The scoping is for the fast per-commit/per-sync gate, not the load-bearing CI gate. See [[lsn_typescript_ci_gate_two_layer]] for the two-layer split.
- **Filtered *install* is the actual bug** — if `node_modules/.bin/tsc` is missing across packages after a filtered install, that's [[lsn_pnpm_filter_install_missing_workspace_bins]], not a scoping problem. Fix the install graph first.
- **Runtime/build-only failure classes** — `tsc` never sees stale build artifacts or source-only `main` fields; scoping doesn't change that gap (it existed under `-r` too). Those need a build/runtime check, not a typecheck.

## Cross-references

- [[lsn_typescript_ci_gate_two_layer]] — the two-layer gate (sync-time + commit-time); this scopes the fast layer without weakening it.
- [[lsn_pnpm_filter_install_missing_workspace_bins]] — the adjacent *install*-side failure (`tsc: command not found`), distinct from this *typecheck*-side scoping.
- [[lsn_cross_project_sync_script_pattern]] — the multi-repo sync-script this gate typically lives in.
- [[lsn_parallel_sessions_first_ask]] — the general principle: tooling should not block on state the author didn't create.

When a monorepo gate blocks on a package outside your diff, retrieve this and its neighbors:

```typescript
search_lessons({
  query: "monorepo typecheck gate blocks unrelated package pnpm filter",
  tools: ["pnpm"],
  languages: ["typescript"],
})
```