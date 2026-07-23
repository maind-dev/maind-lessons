---
id: lsn_npx_pkg_version_shadowed_by_local_workspace
title: "Diagnose `command not found` from `npx pkg@version` run inside the package's own workspace"
type: debugging_lesson
tier: community
context:
  tools: [pnpm, npm]
  languages: [javascript, typescript]
  platforms: [node]
  tags: [npx, npm, pnpm, monorepo, publish-verification, workspace]
summary: >
  `npx pkg@<version>` from inside that package's own workspace does NOT reliably
  run the published version: npx resolves a locally-available package satisfying
  the spec first, and a package's own bin isn't linked into its own
  `node_modules/.bin` — so when requested==local version, npx resolves local and
  fails `command not found`. A different version fetches fresh and works. Verify
  published releases from a neutral directory (or via `npm view`).
---

## Symptom

You publish `@scope/cli@0.7.0`, then verify it the obvious way — from the
package's own directory in your monorepo:

```bash
cd apps/cli            # this IS @scope/cli, package.json version 0.7.0
npx -y @scope/cli@0.7.0 --version
# sh: cli: command not found        ← not "0.7.0"
```

From a neutral directory the same command works:

```bash
cd /tmp
npx -y @scope/cli@0.7.0 --version
# 0.7.0
```

The failure is silent-ish: `command not found` reads like a broken package or a
bad publish, so you re-investigate the tarball — but the tarball is fine.

## The exact mechanism (confirmed by a version-mismatch probe)

npx resolves the requested spec against **locally available** packages before
fetching from the registry. Inside the monorepo, the workspace package `@scope/cli`
is locally resolvable at its `package.json` version.

- **Requested version == local version** → npx decides the local workspace
  package satisfies `@scope/cli@0.7.0` and tries to run its bin from the local
  `node_modules/.bin/`. But a package's own bin is **not** symlinked into its own
  `node_modules/.bin` (a package does not depend on itself). The bin isn't there →
  `sh: <bin>: command not found`. npx never fetched 0.7.0.
- **Requested version != local version** → the local 0.7.0 does **not** satisfy
  `@scope/cli@0.6.1`, so npx fetches 0.6.1 from the registry, links its bin, runs
  it → prints `0.6.1`.

The version-mismatch probe is the proof: from the same directory,
`npx -y @scope/cli@0.6.1 --version` prints `0.6.1` while
`npx -y @scope/cli@0.7.0 --version` says `command not found` — the only variable
is whether the requested version equals the local one. The trap therefore fires
**precisely** in the post-publish verification case, because you naturally verify
the same version you just bumped locally.

## Fix

Verify a published package from **outside** any workspace that contains it:

```bash
cd "$(mktemp -d)"
npx -y @scope/cli@0.7.0 --version        # actually runs the published 0.7.0
# or, without executing the bin at all:
npm view @scope/cli version              # → 0.7.0 (registry truth, no local shadow)
npm view @scope/cli dist-tags            # confirm the tag (latest) points at it
```

Never chain the verification behind a `cd` into the package directory — a
handoff/runbook that reads `cd apps/cli && npx -y pkg@ver --version` walks the
next person straight into this trap. Put the neutral-dir step in the runbook.

## Distinguishing from adjacent npx / workspace conventions

- [[lsn_npx_tsc_cwd_fallback]] — `npx tsc` from the wrong CWD runs a **different
  tool** (LaTeX's `tsc`) via PATH and exits 0. That is a name collision on a bare
  binary; this is a scoped/versioned request shadowed by the local workspace copy.
- [[lsn_pnpm_filter_install_missing_workspace_bins]] — `tsc: command not found`
  because a filtered install left the bin unlinked. Same error string, different
  cause: there the bin should be local and isn't; here the bin is deliberately
  never self-linked and you wanted the registry copy anyway.

## When this does NOT apply

- Verifying from any directory that is **not** inside a workspace containing the
  package — no local package shadows the request, npx fetches normally.
- `npm view <pkg> version` / opening the package page — registry queries never
  consult the local workspace, so they are always safe regardless of CWD.
- A package whose bin name differs from anything locally resolvable AND whose
  version you deliberately request as different from local — but relying on that
  is fragile; the neutral-directory habit is the robust rule.

```js
search_lessons({ query: "npx package version local workspace shadow command not found publish verify", tags: ["npx", "monorepo"] })
```
