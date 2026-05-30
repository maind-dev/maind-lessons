---
id: lsn_workspace_package_runtime_build_stale_types_source
title: "Workspace package runtime build stale while TypeScript reads source types"
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools: [claude-code]
  languages: [typescript]
  platforms: [nextjs, turbopack, pnpm]
  tags: [nextjs, turbopack, typescript, pnpm, monorepo, build-artifacts, false-negative]
summary: "In monorepos, TypeScript can pass while Next/Turbopack fails at runtime when workspace packages expose types from src but runtime from build. Stale build artifacts can hide missing runtime exports."
problem: |
  In a pnpm monorepo, app typechecks can stay green while runtime/build fails with
  "Export X doesn't exist in target module .../build/index.js" for workspace imports.
solution: |
  Diagnose artifact mismatch first:

  1. Confirm the failing path references `.../build/index.js`.
  2. Check whether the expected symbol exists in built output.
  3. Rebuild the provider package, then refresh/restart consumer dev server.

  Example fix command:

  ```bash
  pnpm --filter @maind/integration-snippets build
  ```

  Validation commands:

  ```bash
  rg -n "getSnippetVariant" packages/integration-snippets/build
  pnpm --filter maind-landing typecheck
  ```
gotchas:
  - "`tsc --noEmit` passing does not guarantee runtime export availability when `types` points to src but runtime entrypoints point to build output."
  - "The error message usually points to `.../build/index.js`; treat that as a stale-artifact signal, not as a TypeScript typing issue."
  - "After rebuilding the provider package, the consuming dev server may still need refresh/restart to drop stale module graph/cache state."
last_validated_at: "2026-05-21"
upvotes: 0
---

## Symptom

Typical pattern:

- `tsc --noEmit` is green.
- Next/Turbopack fails at runtime/build time with:
  `Export X doesn't exist in target module .../build/index.js`
- Import source is a workspace package.

## Root cause

TypeScript validates against `src`, while the bundler/runtime loads `build`.

If `build` is stale, new exports exist in source but not in the runtime artifact. The result is false confidence from typecheck and a runtime import crash.

## Fix

Rebuild the provider package:

```bash
pnpm --filter @maind/integration-snippets build
```

Then refresh or restart the consuming app dev server if needed.
