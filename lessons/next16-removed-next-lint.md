---
id: lsn_next16_removed_next_lint
title: "Fix 'Invalid project directory' from a stale `next lint` script — Next.js 16 removed the next lint subcommand"
type: debugging_lesson
tier: community
summary: "Next.js 16 removed the `next lint` subcommand (deprecated in 15). A leftover `\"lint\": \"next lint\"` package.json script then fails with 'Invalid project directory provided, no such directory: <path>/lint' — because `next` no longer recognizes `lint` and treats the arg as a directory. Linting silently stops running in CI/pre-commit. Migrate to the ESLint CLI (flat config + eslint-config-next)."
context:
  tools: []
  languages: ["typescript", "javascript"]
  platforms: ["nextjs"]
  tags: ["nextjs", "next16", "eslint", "migration", "tooling"]
---

## Symptom

`pnpm lint` (script = `next lint`) fails with:

```
Invalid project directory provided, no such directory: /path/to/app/lint
```

Typecheck and build still pass, so it's easy to miss that linting has silently
stopped running in CI and pre-commit hooks.

## Root cause

Next.js 16 **removed** the `next lint` subcommand (it was deprecated in 15).
`next` no longer recognizes `lint`, so it interprets the word as a positional
*project directory* argument → the misleading "Invalid project directory" error
pointing at a non-existent `…/lint` folder. The stale `"lint": "next lint"`
script in `package.json` is the culprit; frequently the project also has no
ESLint dependency or config left, so lint is effectively dead.

## Fix — migrate to the ESLint CLI

1. Install ESLint + the Next preset: `pnpm add -D eslint eslint-config-next`.
2. Add a flat config `eslint.config.mjs` using `eslint-config-next`'s flat
   preset (`next/core-web-vitals`, `next/typescript`).
3. Change the script: `"lint": "eslint ."`.

Next ships a codemod for this migration — run `npx @next/codemod@latest` and
pick the lint-to-ESLint-CLI transform, then verify it added the dependency,
the config, and updated the script.

## Verify

```bash
pnpm lint          # should now run eslint, not error on a "directory"
ls eslint.config.* # flat config present
```

## When this does NOT apply

Only relevant to projects upgrading across the Next 15 → 16 boundary that still
carry a `next lint` script. Projects already on the ESLint CLI (or that never
used `next lint`) are unaffected.
