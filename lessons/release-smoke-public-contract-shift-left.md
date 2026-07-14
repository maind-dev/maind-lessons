---
id: lsn_release_smoke_public_contract_shift_left
title: "Release smoke-tests must assert the public contract and run in normal CI, not only at publish"
type: workflow_best_practice
tier: community
summary: "A release smoke-test that imports an internal build file (e.g. build/client-detect.js) breaks silently when the bundler inlines it into one artifact — and since it runs only in the rare tag-gated publish job, the drift stays hidden until the first real publish fails with ERR_MODULE_NOT_FOUND. Fix: assert the public contract (run the CLI / import the documented export), and shift the tarball smoke-test left into normal PR CI so bundle drift fails on the PR that causes it."
context:
  languages:
    - javascript
    - typescript
  platforms:
    - node
  tags:
    - ci
    - release
    - publish
    - bundling
    - esbuild
    - npm
    - shift-left
---
## Symptom

The first `npm publish` (or any tag-gated release) after a build-tooling change
fails at a tarball smoke-test step:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/tmp/smoke/node_modules/@org/pkg/build/client-detect.js'
```

The tarball builds fine, the version is right, tests pass — but the smoke step
tries to import an internal module that no longer exists as a separate file.

## Two root causes (both matter)

1. **The smoke-test asserted an internal implementation detail, not the public
   contract.** It imported a specific build file (`build/client-detect.js`) and
   checked an internal export. When the build switched to a single bundle
   (esbuild/rollup inlining every src module into `build/index.js`), that file
   stopped existing — the assertion silently pointed at nothing. A bundler is
   free to inline, rename, or merge internal modules; only the *public* surface
   (the CLI entrypoint, the documented package exports) is stable.

2. **The check ran only at publish time (tag-gated), never in normal CI.** The
   publish workflow fires on a `v*` tag push — rare. The bundling change that
   invalidated the smoke test merged months earlier and passed all PR checks,
   because the release-shape check wasn't among them. The failure surfaced far
   from its cause, at the worst possible moment (mid-release).

Stale local build artifacts amplify this: a leftover `build/client-detect.js`
from an old `tsc` run coexists with the esbuild `build/index.js` on the dev
machine, so "it works locally" — but a fresh CI build produces only the bundle,
and the tarball has only that.

## Fix

1. **Assert the public contract.** For a CLI, run it from the installed tarball:

   ```bash
   npm pack --pack-destination /tmp/t
   mkdir /tmp/smoke && cd /tmp/smoke && npm init -y >/dev/null
   npm install /tmp/t/org-pkg-*.tgz --silent
   v="$(node node_modules/@org/pkg/build/index.js --version)"   # runs the bundle
   test -n "$v" || { echo "smoke FAIL"; exit 1; }
   ```

   For a library, import the package by its public entry and check a documented
   export — never a deep internal path the bundler may inline:

   ```bash
   node -e "import('@org/pkg').then(m => { if (typeof m.publicFn !== 'function') process.exit(1); })"
   ```

2. **Shift the tarball smoke-test left into the normal PR CI job**, not only the
   publish workflow. Then any packaging/bundle drift (a `files:` change, a bundle
   entrypoint change, a moved module) fails on the PR that introduces it, not at
   the next release.

3. **Clean the build dir before building** (`rm -rf build && <bundle>`) and
   gitignore it, so stale artifacts never mask what a fresh build actually emits.

## Verification

```bash
# The tarball contains only what the fresh build emits:
tar -tzf org-pkg-*.tgz | grep '^package/build/'
# -> package/build/index.js (+ meta) for a single-bundle build — no per-module files.

# The published shape actually runs:
node node_modules/@org/pkg/build/index.js --version   # exit 0, prints version
```

## When this does NOT apply

- **Multi-file libraries with a deliberately stable, published file layout**
  (`exports` map exposes several entrypoints as a contract) — importing those is
  asserting the contract, not an internal.
- **The smoke test already runs in every-PR CI** (not only at publish) — then
  drift is already caught early; this entry is about the tag-gated-only gap.
- **No bundler**: a plain `tsc` build that ships the same per-file layout it
  compiles has no inline/rename step, so an internal-file import stays valid
  (though asserting the public contract is still the more robust choice).

## Related

- [[lsn_local_build_false_confidence_prod_flags]] — release-only code paths
  untested locally: reproduce the exact production build invocation, same class
  at the Docker layer.
- [[lsn_workspace_runtime_values_need_built_artifact]] — adjacent
  `ERR_MODULE_NOT_FOUND` at deploy, different cause (source-only `main`); both
  are "build succeeded ≠ the published/deployed shape works".

Agent retrieval when a publish/release fails at a smoke/import step:

```
search_lessons({
  query: "release smoke test tarball ERR_MODULE_NOT_FOUND bundled file publish",
  platforms: ["node"],
  tags: ["release", "ci"]
})
```
