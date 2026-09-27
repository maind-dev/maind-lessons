---
id: lsn_npm_publish_leaks_workspace_protocol
title: 'Fix `EUNSUPPORTEDPROTOCOL Unsupported URL Type "workspace:"` — publish pnpm workspaces with `pnpm publish`'
type: debugging_lesson
tier: community
summary: "In a pnpm (or yarn) workspace, `npm publish` does NOT rewrite `workspace:*` / `workspace:^` dependency specifiers — it ships them verbatim into the registry tarball. Consumers then break at install with `npm error EUNSUPPORTEDPROTOCOL Unsupported URL Type \"workspace:\"`. `pnpm publish` rewrites `workspace:*` to the linked package's real version at pack time. Publish workspace packages with the workspace-aware tool, and verify the packed manifest."
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [pnpm, npm]
  tags: [pnpm, monorepo, workspace, publish, release, npm]
last_validated_at: "2026-06-22"
---

## Symptom

You publish a package from a pnpm monorepo and it builds, tests pass, the
tarball uploads cleanly:

```
+ @org/my-package@1.2.3
```

But a consumer installing it from the registry crashes immediately:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

`npx @org/my-package@1.2.3` fails the same way. The publish "succeeded" — the
artifact is just uninstallable.

## Root cause

The package depends on a sibling workspace package via the `workspace:`
protocol, which is correct for local development:

```json
"dependencies": {
  "@org/sibling": "workspace:*"
}
```

`workspace:*` / `workspace:^` / `workspace:~` are **pnpm/yarn-only protocol
specifiers**. They are meaningless to the npm registry — a consumer's `npm`/
`pnpm`/`npx` cannot resolve `workspace:*` to a version.

The workspace-aware publishers (`pnpm publish`, `yarn npm publish`) **rewrite**
these specifiers to the linked package's real version at pack time
(`workspace:*` → e.g. `"1.4.0"`). Plain **`npm publish` does not** — it copies
`package.json` verbatim, leaking `workspace:*` into the published tarball.

So the failure mode is: a package that publishes fine under `pnpm publish` ships
a broken tarball the day someone runs `npm publish` instead (a habit from
single-package repos, a copy-pasted release doc, or a CI step that calls the
wrong tool). An earlier version published with `pnpm publish` looks identical in
git but has a correct manifest on the registry — making the regression easy to
misread as "the new code broke it" when nothing in the code changed.

## Fix

Publish workspace packages with the workspace-aware tool:

```bash
# pnpm
cd packages/my-package
pnpm publish --access public      # rewrites workspace:* → the real version

# yarn (berry)
yarn npm publish
```

Then verify the **published** manifest, not the local one:

```bash
npm view @org/my-package@1.2.3 dependencies
# every dep must be a real range — NO "workspace:*" anywhere
```

Or inspect before publishing — `pnpm pack` applies the same rewrite the publish
would, so the packed tarball is the source of truth:

```bash
pnpm pack --pack-destination /tmp
tar -xzOf /tmp/org-my-package-1.2.3.tgz package/package.json \
  | grep -i workspace      # expect: no matches
```

A registry version is immutable, so a leaked `workspace:*` cannot be fixed in
place: bump to a new patch version and republish correctly (unpublishing the
broken one is allowed within npm's 72h window, but blocks re-using that exact
version for 24h).

## When this does NOT apply

- **Single-package repos** — no `workspace:` specifiers exist, `npm publish` is
  fine.
- **Workspace packages never published to a registry** (consumed only via the
  in-repo symlink) — the protocol resolves locally; nothing leaks.
- **A release tool that already rewrites** (changesets' `publish`, a CI step
  invoking `pnpm publish`, Nx/Turbo release pipelines) — the rewrite is handled;
  the rule is "don't bypass it with a manual `npm publish`".
- **`devDependencies`-only workspace refs** — a consumer's `npm install`
  installs only `dependencies`, so a `workspace:*` in `devDependencies` won't be
  resolved by downstream installs (though it still pollutes the published
  manifest — prefer rewriting anyway).

## Detection / prevention

- Any `EUNSUPPORTEDPROTOCOL` + `Unsupported URL Type "workspace:"` at install
  time is this, full stop.
- Add a publish guard: a `prepublishOnly` (or CI release step) that fails if
  `grep -q '"workspace:' package.json` after build but the publisher is `npm`.
- Pin the release command in the repo's CONTRIBUTING/release doc to the
  workspace-aware tool — a doc that says `npm publish` is the latent bug.

```
# Before publishing any package out of a monorepo:
search_lessons({ query: "pnpm publish workspace protocol EUNSUPPORTEDPROTOCOL", platforms: ["pnpm"] })
```

## Cross-references

- [[lsn_pnpm_workspace_prepare_script]] — sibling pnpm-workspace publish pitfall:
  a built-artifact package needs a `prepare` script so consumers build it.
- [[lsn_workspace_runtime_values_need_built_artifact]] — the `main: ./src/index.ts`
  variant: works for bundlers, crashes pure-Node consumers. Same family of
  "publishes fine, breaks for one consumer class".
- [[lsn_npx_pkg_version_shadowed_by_local_workspace]] — adjacent: `npx pkg@v`
  run from inside the monorepo resolves the local workspace, not the registry —
  why you verify a publish from `/tmp`.
