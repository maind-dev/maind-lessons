---
id: lsn_regenerated_artifact_missing_inputs_nulls_consumer
title: "Diagnose null/placeholder fields in a committed generated artifact regenerated with missing inputs"
type: debugging_lesson
tier: community
summary: "A committed generated artifact (version manifest, attribution, codegen) is owned by a build that runs where its inputs exist. Regenerating it locally with an input ABSENT degrades fields to null/placeholder — then a consumer in another package (or CI) breaks on the null. Smell: a diff where populated fields flip to null. Fix: let the build own it (revert the local regen), or sanity-check before writing."
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [node, pnpm]
  tags: [monorepo, generated-artifacts, build, ci, codegen, false-negative]
---

## Symptom

You bump a version (or touch some source), and a script regenerates a committed
artifact as a side effect — a version manifest, a license/attribution file,
generated types, an OG-image map, a search index. You commit it. Locally your
checks pass. Then CI fails in a place you didn't touch:

```
apps/dashboard typecheck: src/.../extension-version.tsx(31,39):
  error TS2345: Argument of type 'null' is not assignable to parameter of type 'string'.
```

You only ran the typecheck for the package you edited (the extension); the break
is in a *different* package (the dashboard) that consumes the artifact.

## Root cause

The artifact is **owned by a build step** (`predev`/`prebuild`, a release
script, a codegen hook) that runs in an environment where all its inputs are
present. Yours wasn't: the generator read inputs that don't exist on your
machine and wrote their absence as data.

In the real case, a `sync-versions.mjs` script stamped each package's
`publishedAt` from the mtime of its built `.vsix` artifact:

```js
function vsixBuiltAt(file) {
  const p = resolve(ROOT, `apps/dashboard/public/${file}`);
  if (!existsSync(p)) return null;          // ← absent locally → null
  return new Date(statSync(p).mtimeMs).toISOString();
}
```

The `.vsix` files only exist after a release build, not in a fresh checkout. So
a local regen produced `"publishedAt": null` for every package — and a consumer
typed `formatDate(publishedAt: string)` rejected the null at compile time. The
generator didn't error; it faithfully serialized "input missing" as `null`.

The tell is in the diff: **populated fields flip to `null` / `""` / a
placeholder**, while the field you actually meant to change (the version) is a
small part of the hunk. That pattern is "regenerated in an incomplete
environment", not a real edit.

## Fix

The artifact is a build output, not source you hand-maintain. Two clean options:

1. **Let the build own it.** Revert your local regen and keep only the *input*
   change (the version bump in `package.json`, the new source). The build step
   regenerates the artifact with real values on the next CI/deploy run.

   ```bash
   git checkout origin/main -- path/to/generated-artifact.json
   ```

2. **Refuse to write degraded output.** If the artifact genuinely must be
   committed, make the generator fail instead of emitting null/placeholder when
   an input is missing — the same atomic-tmp + sanity-check shape used for
   generated types (see [[lsn_supabase_gen_types_stderr]]):

   ```js
   if (entries.some((e) => e.publishedAt == null)) {
     throw new Error("refusing to write: missing inputs (run in a release env)");
   }
   ```

And the verification half: **when you change a shared or generated file, run the
checks of its CONSUMERS, not just the package you edited.** In a monorepo a
generated artifact's blast radius crosses package boundaries — typecheck the
whole workspace:

```bash
pnpm -r typecheck          # not just `pnpm -F <the-package-you-edited> typecheck`
```

## When this does NOT apply

- **Genuinely hand-maintained files.** If the file is source you author by hand
  (not produced by a generator), a null is a real bug to fix in place, not a
  missing-input artifact.
- **The generator runs everywhere with complete inputs.** If every environment
  (local, CI, release) has the inputs, a local regen is reproducible and safe to
  commit — there's no degraded state to capture.
- **The artifact is gitignored.** Then it's never committed; the build produces
  it fresh each time and there is nothing to corrupt in version control.
- **A field that is legitimately nullable.** If the consumer already handles
  `null` (optional chaining, a fallback), the regen didn't break anything —
  verify the consumer's type, don't assume.

## Detection

- A diff on a generated/committed file where **previously-populated fields became
  `null` / `""` / `0` / a placeholder** — especially timestamps, hashes, sizes,
  counts read from build outputs.
- CI fails in a package you didn't edit, on a value sourced from a committed
  data/manifest file.

```
search_lessons({ query: "generated committed artifact regenerated missing inputs null consumer", platforms: ["pnpm"] })
```

## Cross-references

- [[lsn_supabase_gen_types_stderr]] — sibling: a committed generated file becomes
  invalid (there via a stderr banner, here via missing inputs). Same remedy
  family: atomic-tmp + sanity-check, never commit the corrupted version.
- [[lsn_license_distribution_compliance]] — a build-owned attribution artifact +
  a staleness gate; same "the build owns the generated file" principle.
- [[lsn_workspace_runtime_values_need_built_artifact]] — adjacent "build-stage
  green, consumer breaks" monorepo class, at the package-resolution layer.
