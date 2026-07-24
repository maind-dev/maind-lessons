---
id: lsn_next_server_only_breaks_node_test
title: "Fix node:test failing to import `server-only` modules — split pure helpers into a shared module"
type: debugging_lesson
tier: community
summary: "A Next.js module that starts with `import \"server-only\"` cannot be loaded by the node:test runner (node --import tsx --test): the server-only package's conditional exports throw outside a react-server context, so the import itself fails before any test runs. Typecheck and next build stay green. Fix: extract the pure, testable helpers into a sibling module WITHOUT server-only and have the server-only orchestrator import them — test the shared module."
context:
  tools: []
  languages:
    - typescript
  platforms:
    - nextjs
  tags:
    - nextjs
    - server-only
    - node-test
    - testing
    - module-boundaries
---

## Symptom

You add pure, easily testable functions (mapping, validation, payload shaping) to a
server-side module that guards itself with the canonical boundary marker:

```ts
// lib/assistant/codebase-search.ts
import "server-only";
export function mapResults(payload: unknown): Hit[] { /* pure */ }
export async function searchFusion(q: string) { /* fetch + RPC */ }
```

A `node:test` file importing it (runner: `node --import tsx --test "src/**/*.test.ts"`)
fails at IMPORT time — before a single test executes:

> This module cannot be imported from a Client Component module. It should only be
> used from a Server Component.

`tsc --noEmit` and `next build` are both green — only the test runner falls over, and
the error text ("Client Component") is misleading for a Node process.

## Why

The `server-only` package is an export-conditions tripwire: its `react-server`
condition maps to an empty module, its `default` condition maps to a file whose only
job is to throw. Next.js sets the `react-server` condition when bundling Server
Components, so the import is a no-op there. A plain Node process (the test runner)
resolves the `default` condition → the throw fires during module evaluation.

## Fix: shared-module split

Move the pure helpers into a sibling module with NO `server-only` and no server-only
imports; keep the orchestrator (env access, fetch, DB clients) behind the marker:

```ts
// codebase-search-shared.ts — no "server-only", no imports; loadable by node:test
export function mapResults(payload: unknown): Hit[] { /* pure */ }

// codebase-search.ts — the guarded orchestrator
import "server-only";
import { mapResults } from "./codebase-search-shared";
```

The test file imports the shared module directly. Same pattern many codebases already
use for route-allowlist modules shared between server and client validation — reuse
that precedent rather than inventing a new layout.

### Alternative (usually worse): `--conditions react-server`

`node --conditions react-server --test` silences the tripwire, but it flips the
export condition for EVERY package in the graph — react itself and other
dual-condition packages then resolve their server variants, which changes behavior
you did not mean to change. Prefer the module split; it also keeps the testable
surface visibly free of I/O.

## Verification

```bash
node --import tsx --test "src/**/*.test.ts"   # imports resolve, tests run
```

## When this does NOT apply

- Test runners with module mocking (vitest/jest) where `server-only` is stubbed via
  an alias/moduleNameMapper — the import never evaluates the real package.
- Modules that don't import `server-only` (directly or transitively) — plain shared
  modules already load fine.
- The inverse boundary problem — a SERVER component importing values from a
  `"use client"` module — is [[lsn_rsc_value_import_from_use_client]], not this.

## Related

- [[lsn_rsc_value_import_from_use_client]] — the mirror-image boundary footgun
  (client-module value imported server-side becomes a proxy).
- [[lsn_next_dynamic_ssr_false_client_only]] — another server/client boundary rule
  that only one gate (build, not typecheck) catches.

```ts
search_lessons({ query: "server-only import node test runner fails cannot be imported client component", platforms: ["nextjs"] })
```
