---
id: lsn_css_side_effect_import_skipped_by_module_grep
title: "Trace dangling `import \"...css\"` after cross-workspace move — TypeCheck doesn't resolve side-effect CSS imports"
type: debugging_lesson
tier: community
summary: "Cross-workspace file move + grep-based caller switch can leave dangling `import \"...css\"` side-effect imports because they don't match the `from \"...\"`-pattern most module-import greps use. TypeCheck doesn't resolve CSS imports — only the bundler build does. Fix: always grep both import classes, and run a bundler build (`next dev`/`vite dev`) before declaring a refactor done."
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  languages:
    - typescript
    - javascript
  platforms: []
  tags:
    - refactoring
    - cross-workspace
    - monorepo
    - css
    - side-effect-imports
    - typecheck-gap
    - build-error
    - grep-discipline
---

## Symptom

You moved a file (or a directory of files) from one workspace to another in a pnpm/yarn/npm monorepo. You updated all callers via a `from "<old path>"` → `from "<new path>"` grep+replace. `pnpm -r typecheck` is green. You push, or run `pnpm -F <app> dev`, and get:

```
Module not found: Can't resolve '@/components/<old-path>/<file>.css'
./apps/<app>/src/app/layout.tsx (13:1)

  11 | import { ConsentProvider, ConsentBanner } from "@maind/ui";
  12 | import "./globals.css";
> 13 | import "@/components/<old-path>/<file>.css";
     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

The dangling import is for a CSS file — a side-effect import without a `from`-clause, that your earlier grep didn't match.

## Why typecheck didn't catch it

CSS imports in TS/TSX are treated by the TypeScript compiler as **string literals** only. The compiler validates the JS/TS syntax around the `import "..."` statement but does **not** resolve the path. CSS resolution happens at bundler-time:

| Layer | Resolves CSS imports? |
|---|---|
| `tsc --noEmit` | ❌ no |
| `next lint` / `eslint` | ❌ no (unless a custom resolver plugin is wired up) |
| `next dev` / `next build` | ✅ yes (Webpack/Turbopack resolver) |
| `vite dev` / `vite build` | ✅ yes |
| `pnpm -F <app> dev` first request | ✅ yes (first SSR pass triggers resolution) |

A refactor that's "typecheck-green" can still have dangling CSS-side-effect imports — they only surface when a bundler actually walks the import graph.

## Fix recipe — grep both import classes

When refactoring a path, grep for **two** patterns, not one:

```bash
# 1. Module-imports with `from`-clause (ES-module-style)
grep -rE "from\s+['\"][^'\"]*<old-path>" apps/ packages/

# 2. CSS / side-effect imports (no `from`-clause, no binding)
grep -rE "import\s+['\"][^'\"]*<old-path>[^'\"]*\.css['\"]" apps/ packages/

# Optional: catch all side-effect imports regardless of extension
# (some setups import .scss, .sass, .less, .json side-effect-style)
grep -rE "^import\s+['\"][^'\"]*<old-path>" apps/ packages/
```

Pattern 1 catches imports like `import { X } from "@/path"`. Pattern 2 catches imports like `import "@/path/file.css"` — these have no binding and no `from`-keyword. The two patterns are disjoint; running only one is a refactor-foot-gun.

### Pre-push verification

`pnpm -r typecheck` is necessary but not sufficient. For any refactor touching files imported across the monorepo, the pre-push gate must include a real bundler build per affected app:

```bash
# For each app that imports the moved files:
cd apps/<app>
pnpm dev    # or: pnpm build
```

A `dev` run is faster than `build` and reveals dangling imports within a few seconds of the first request. A `build` (production compile) is slower but catches additional issues — for high-traffic refactors, run both. The build-error surface is wider than typecheck:

- CSS-import-resolution (this convention)
- Dynamic-import-resolution (e.g. `next/dynamic` boundaries — see [[lsn_next_dynamic_ssr_false_client_only]])
- Asset-file-resolution (images, fonts referenced by path)
- Server-Component vs Client-Component boundary violations

## When NOT to use this

- **Refactors that don't move files** (e.g. rename a function, add a property) — no CSS-import-path change possible.
- **Workspaces with all CSS imported through `@import` in a single `globals.css`** — the `@import` lives in CSS, not in JS, and is resolved by the CSS parser (PostCSS / Tailwind). No JS-grep ever needed.
- **TypeScript-only libraries with no CSS-side-effect-imports anywhere** — the second grep returns nothing, no recipe needed.

The recipe is specifically for refactors that move JS/TS files which are imported alongside CSS-side-effect imports in the calling code. If the moved tree contains only `.ts`/`.tsx` files with no CSS-import callers, pattern 1 suffices.

## Anti-patterns

- **Trusting `pnpm -r typecheck` as the final gate for a refactor.** TypeCheck is a strong signal for module-graph correctness but blind to CSS/asset resolution. Bundler build is the complementary layer.
- **Greppen nur über `from`-Imports.** The TypeScript ES-module spec allows `import "module-name"` as a side-effect-only import — same `import` keyword, different shape. Side-effect-style is idiomatic for CSS, polyfills, and some library setup files.
- **Assuming `.next/`/`.vite/`/`dist/` cleanup is unnecessary.** Stale build caches can mask dangling imports for the first run after a refactor — they show the old module-graph. A `rm -rf .next/ dist/ .vite/ && pnpm dev` confirms the refactor on a clean slate.
- **Using a path alias resolver that silently falls back to "leave the path as-is" on miss.** Some bundlers print the unresolved path verbatim with no clear "not found" prefix. Read carefully — `Module not found: Can't resolve '<path>'` is the bundler-correct surface for this class.

## Related vetted conventions

- [[lsn_npx_tsc_cwd_fallback]] — another "validation says clean, reality isn't" class: `npx tsc` from wrong CWD silently returns success.
- [[lsn_next_dynamic_ssr_false_client_only]] — TypeCheck/dev-server pass, only production build catches it. Same family of "build-layer-only" diagnostics.
- [[lsn_auto_commit_package_json_review]] — local builds pass thanks to cached `node_modules`, CI fresh-install fails. Recommends fresh Docker build before push as the cousin of fresh bundler build.

To verify if this convention applies to a refactor session:

```ts
await search_lessons({
  query: "css side effect import refactor module not found",
});
// Expect lsn_css_side_effect_import_skipped_by_module_grep in results.
```
