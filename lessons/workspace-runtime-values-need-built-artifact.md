---
id: lsn_workspace_runtime_values_need_built_artifact
title: "ERR_MODULE_NOT_FOUND from workspace package — source-only `main` breaks pure-Node consumers"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript, javascript]
  platforms: []
  tags: [pnpm, monorepo, workspace, esm, module-resolution, node, build, typescript]
summary: "A pnpm workspace package configured with `main: ./src/index.ts` and runtime value exports (functions, arrays, classes) works fine for bundler consumers (Next.js, webpack, turbopack) but crashes pure-Node consumers with `ERR_MODULE_NOT_FOUND` because Node cannot load `.ts` directly. tsc-typecheck passes silently because the compile-time resolution finds the source — the failure only surfaces at runtime in production."
last_validated_at: "2026-05-28"
---

# Workspace package source-only `main` crashes pure-Node consumers

## Symptom

A monorepo workspace package (e.g. `@org/types`) is declared with
`main: "./src/index.ts"` and exports runtime values:

```ts
// packages/types/src/index.ts
export function mapClientName(name: string): Family { /* ... */ }
export const CLIENT_FAMILIES = ["claude-code", "cursor", "..."] as const;
export type Family = (typeof CLIENT_FAMILIES)[number];
```

Local dev appears to work. `pnpm typecheck` reports zero errors across
the monorepo. Bundler consumers (Next.js dashboard, Vite app) build
and run. Tests pass. The package looks healthy.

Then a Node-only consumer (Fly.io-hosted MCP server, CLI tool, npm-
published bridge) deploys — and crashes on startup:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/repo/apps/mcp-server/node_modules/@org/types/src/index.ts'
  imported from /repo/apps/mcp-server/build/lib/handler.js
```

The build succeeded. The image was pushed. The container starts,
runs for ~2 seconds, exits with code 1. The deploy rolls back.

## Root cause

The compiled JavaScript of `handler.js` contains a literal import:

```js
import { mapClientName } from "@org/types";
```

Node's ESM resolver follows the pnpm workspace symlink at
`node_modules/@org/types` to `packages/types/`, reads `package.json`,
sees `"main": "./src/index.ts"`, and tries to load that file. Node
refuses — `.ts` is not a supported file extension. `ERR_MODULE_NOT_FOUND`.

The bundler consumers don't hit this because webpack/turbopack read
the source themselves at compile time, never relying on Node's runtime
resolver. Same for tsc — at typecheck time tsc reads the `.ts` source
directly to validate types. The error class "Node can't load .ts" is
invisible to every check that runs before deploy.

## Fix

Mirror the build-artifact pattern used by other workspace packages
that ship runtime values (e.g. `@org/schemas`):

**1. `packages/types/package.json`** — change `main` to the built JS:

```json
{
  "main": "./build/index.js",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./build/index.js"
    }
  },
  "files": ["src", "build"],
  "scripts": {
    "build": "tsc",
    "prepare": "tsc"
  }
}
```

**2. `packages/types/tsconfig.json`** — emit-enabled, Node16 module:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "declaration": true,
    "strict": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "build"]
}
```

**3. Dockerfile** (or CI build) — explicitly build the workspace
package before the consumer, so `build/` exists when the runner stage
copies it:

```dockerfile
COPY packages/types/ ./packages/types/
RUN pnpm install --filter "mcp-server..." --frozen-lockfile
RUN pnpm --filter @org/types build \
    && pnpm --filter mcp-server build

# Runner stage: layer the built artifact in
COPY --from=build /repo/packages/types/build /repo/packages/types/build
```

`prepare` (rather than `postinstall`) covers the common npm/pnpm
lifecycle for downstream consumers — see [[lsn_pnpm_workspace_prepare_script]].

Verify post-fix with a Node-only smoke test:

```bash
cd apps/mcp-server
node -e 'import("@org/types").then(m => console.log(Object.keys(m)))'
# expected: [ 'mapClientName', 'CLIENT_FAMILIES' ]
```

## When this does NOT apply

- **Type-only workspace packages**: if the package exports ONLY type
  declarations (no `export function`, no `export const`), TypeScript
  erases the imports at compile time and the consumer's `.js` never
  contains a runtime require/import. Source-only `main` is fine.
  Diagnostic: `tsc --noEmit` then `grep` the compiled JS for the
  package name — if zero hits, you're type-only.
- **Bundler-only ecosystem**: if every consumer of the package runs
  through webpack/turbopack/Vite/Rollup at build time, the bundler
  inlines the source. Pure-Node never reaches the package. Common
  for shared component libraries consumed only by Next.js apps.
- **Same-process dev with tsx / ts-node**: during local development
  with a TS-aware Node loader, `.ts` resolves. The trap only fires
  in production-style `node build/index.js` execution. Mixed teams
  can ship "works on dev, breaks on prod" for weeks before hitting it.

## Related patterns + discovery

This is the "I shipped a workspace package that crashes in production"
class. Cross-references:

- [[lsn_pnpm_workspace_prepare_script]] — the complementary case:
  workspace package HAS a build but the build script doesn't run
  automatically on the consumer's install. This convention covers the
  inverse: no build exists at all.
- [[lsn_postgres_function_overload_silent]] — same "silently works
  for one consumer, silently breaks for another" pattern, at the SQL
  function-resolution layer.
- [[lsn_subagent_edit_not_write]] — broader theme: build-stage success
  ≠ deploy-stage success; verify the actual end-to-end runtime, not
  just the type-check.

When a workspace package is "added but nothing else changed" and a
downstream service starts crash-looping on deploy, ask:

```
search_lessons({
  query: "workspace package module not found ERR_MODULE_NOT_FOUND runtime",
  tags: ["pnpm", "monorepo"],
  limit: 5
})
```

This is one of the few problem classes where the symptom (production
crash) is far away from the cause (a package.json field decision in
a different folder).
