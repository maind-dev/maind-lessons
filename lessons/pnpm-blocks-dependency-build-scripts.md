---
id: lsn_pnpm_blocks_dependency_build_scripts
title: "Diagnose a missing native binary after pnpm install — pnpm v9/v10 blocks dependency postinstall scripts by default"
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [docker]
  tags: [pnpm, postinstall, native-modules, build-scripts]
summary: "pnpm v9/v10 do NOT run dependencies' install/postinstall scripts by default (supply-chain hardening). Native deps that fetch or compile a binary in a postinstall (onnxruntime-node, esbuild, sharp, better-sqlite3 via prebuild-install/node-gyp) then have no binary and throw 'cannot find module'/missing-binding at first use. Allowlist them under onlyBuiltDependencies, or run `pnpm rebuild <pkg>`."
last_validated_at: "2026-06-01"
---

## Symptom

A native dependency installs without error but fails at first use:

```
Error: Cannot find module '.../onnxruntime_binding.node'
# or: "was compiled against a different Node.js version", "missing binding"
```

On install you may have seen a quiet banner:

```
Ignored build scripts: onnxruntime-node, esbuild, protobufjs.
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

## Why

Since v9, pnpm **does not execute lifecycle scripts of dependencies** by default — a deliberate supply-chain-hardening change (a malicious postinstall can't run on `install`). But legitimate native packages rely on that postinstall to fetch a prebuilt binary (`prebuild-install`) or compile one (`node-gyp`). Blocked script → no binary → runtime failure, far from the install that caused it.

## Fix

Allowlist the packages whose build scripts you trust, in `pnpm-workspace.yaml` (or `package.json` `pnpm.onlyBuiltDependencies`):

```yaml
onlyBuiltDependencies:
  - onnxruntime-node
  - esbuild
```

Then reinstall. For a one-off, `pnpm rebuild <pkg>` runs that package's build script explicitly.

**Docker gotcha:** a slimmed prod install often uses `pnpm install --prod --ignore-scripts` (to skip workspace `prepare` hooks). `--ignore-scripts` overrides the allowlist too, so the native binary is skipped even when allowlisted. Run `pnpm rebuild <pkg>` after that install to fetch it.

## When this does NOT apply

- **Pure-JS dependencies** (no postinstall) — nothing to allowlist.
- **npm / yarn classic** — they run dependency scripts by default, so this specific block doesn't occur (you have the opposite, weaker, security posture instead).
- **Packages whose binary ships inside the npm tarball** (no postinstall fetch) — they work regardless of the script block.

```
search_lessons({ query: "pnpm ignored build scripts native module missing", tools: ["pnpm"] })
```
