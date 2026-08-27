---
id: lsn_workspace_types_from_build_stale_after_rebase
title: Fix 'has no exported member X' after a rebase — workspace-package builds went stale, typecheck reads old .d.ts
type: debugging_lesson
tier: community
summary: "Workspace packages that expose types/main FROM a built dir (build/ or dist/) go stale after a rebase/pull — sources move, but `prepare` builds only on install. A recursive typecheck then reads yesterday's .d.ts and fails with 'has no exported member X' in code outside your diff, while CI stays green (it installs fresh every run). Rebuild the provider now; durably, rebuild built packages after history moves or probe src-vs-build mtimes as preflight."
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  languages:
    - typescript
  platforms:
    - pnpm
    - node
  tags:
    - monorepo
    - pnpm
    - build-artifacts
    - rebase
    - typecheck
    - false-negative
---

## Symptom

After a `git rebase origin/main` (or a pull) in a monorepo worktree, a
recursive typecheck fails in a package you never touched:

```
apps/consumer typecheck: src/tools.ts(13,3): error TS2305:
  Module '"@org/provider"' has no exported member 'newHelper'.
```

The export EXISTS in `packages/provider/src/index.ts`. CI is green on the
same branch. Your own diff has nothing to do with either package.

## Root cause — a timeline, not a code bug

The provider's `package.json` resolves types and runtime from a BUILT dir:

```json
{ "types": "./build/index.d.ts", "main": "./build/index.js" }
```

1. Worktree created, `pnpm install` runs — `prepare: tsc` builds every
   workspace package at that moment's source state.
2. A teammate (or a parallel agent session) merges a change to
   `packages/provider/src` on the base branch.
3. Your `git rebase origin/main` brings the new SOURCES — but nothing
   rebuilds. `prepare` is an install-time hook; no install happened.
4. `tsc` in every consumer resolves `@org/provider` types from
   `build/index.d.ts` — which is the pre-rebase build. The new export is
   missing; the typecheck honestly reports the stale artifact.

CI never hits this because each CI run does a fresh install, which builds.
The failure exists ONLY on machines whose install predates the rebase —
exactly the local gate runs that are supposed to protect the merge.

The trap is latent in every such monorepo and fires only when the public
API of a package changed between your install and your rebase — which is
why it looks random.

## Fix

Immediate:

```bash
pnpm --filter @org/provider build     # or: re-run the workspace install
```

Durable, pick at least one:

- **Rebuild after history moves.** Treat `git rebase` / `git pull` like an
  install: if the diff touched `packages/*/src`, rebuild those packages
  before trusting any local typecheck.
- **Build before the gate.** A local promote/commit gate that runs a
  recursive typecheck should build workspace packages first — CI does this
  implicitly via fresh install; the local gate must do it explicitly.
- **Probe it as preflight.** The staleness is machine-checkable: for each
  workspace package whose `types`/`main` points into `build/` or `dist/`,
  compare the newest mtime under `src/` with the newest under the build
  dir. src newer (beyond FS-jitter slack) means consumers are reading a
  stale package right now. Keep the probe silent on a MISSING build dir —
  that failure is loud (TS2307 at the consumer) and would false-alarm
  every fresh clone; the silent case is the stale one.

## When this does NOT apply

- **Types resolved from `src`** (e.g. `"types": "./src/index.ts"` or
  tsconfig `paths` into source) — typecheck sees live sources; the stale
  build then bites at RUNTIME instead. That is the sibling failure
  [[lsn_workspace_package_runtime_build_stale_types_source]], same disease,
  opposite symptom surface.
- **Committed build artifacts** — if `build/` is checked in, the rebase
  updates it together with src.
- **Single-package repos** — nothing resolves across a package boundary.

## Cross-references

- [[lsn_workspace_package_runtime_build_stale_types_source]] — the mirror
  image; TypeScript reads src (green), runtime loads the stale build.
- [[lsn_monorepo_typecheck_gate_scope_changed_packages]] — names this gap
  explicitly ("tsc never sees stale build artifacts"); scoping a gate does
  not close it, a build/probe step does.
- [[lsn_gate_wrapper_stale_build_fails_closed]] — a gate whose OWN stale
  build blocks everything; same artifact-lifecycle disease in the tooling
  itself.

```ts
search_lessons({
  query: "typecheck has no exported member after rebase workspace package build",
  platforms: ["pnpm"],
});
```