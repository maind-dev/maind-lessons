---
id: lsn_npx_published_source_needs_version_bump
title: "Fix an `npx`-distributed package change that never reaches users — bump the version in every place it lives"
type: debugging_lesson
tier: community
summary: "A package run via `npx -y <pkg>` is resolved by published version, not by your local source — so editing its source without bumping `package.json` means npx keeps serving the old version and the change never reaches users. If the version is also duplicated in a hand-maintained source constant, both must move in the same commit; a pre-commit guard that blocks 'source changed, version unchanged' is the right enforcement."
context:
  tools: [npm, pnpm, git]
  languages: [typescript, javascript]
  platforms: [node]
  tags: [npm, npx, publishing, semver, version-bump, pre-commit, distribution]
---

# A source change to an `npx`-distributed package needs a version bump

## Symptom

You change the source of a package that downstream users invoke with
`npx -y @org/some-tool` (a CLI, an MCP bridge, a codegen tool). Locally
everything works — your edited source runs, typecheck is green, tests
pass. But users report the new behavior never appears, even after they
"reinstall". Or: your sync/commit is blocked by a pre-commit guard like

```
❌ source change without version bump
   Changed: src/client-detect.ts
   Missing from commit: package.json ("version")
   Missing from commit: src/version.ts (VERSION constant)
```

The guard is not noise. It is catching a distribution bug before it ships.

## Root cause

`npx -y @org/some-tool` resolves the package **by published version from
the registry**, not from your working tree. It downloads (or reuses a
cached copy of) the latest published version and runs that. Your source
edit lives only in git until you (a) bump the version and (b) `npm
publish`. Until both happen:

- `npx` keeps serving the previously published version — your change is
  invisible to every user, no matter how many times they re-run.
- If you publish *without* bumping, the registry rejects it (you cannot
  overwrite an existing version) — or worse, with some flows you ship
  under the old version number and caches never invalidate.

This is the same class as "build succeeded ≠ users got it": the failure
is far from the cause. The diff looks complete; the distribution is not.

## The duplicated-version trap

Many distributed packages keep the version in **two** places that must
agree:

1. `package.json` → `"version"` — what the registry and `npx` resolve.
2. A hand-maintained source constant, e.g.

   ```ts
   // version.ts — read separately from package.json because importing
   // JSON at runtime forces an awkward module shape under Node16
   // resolution. Keep in sync with package.json's "version".
   export const VERSION = "0.3.0";
   ```

   used for `--version` output, telemetry, or a User-Agent header.

If you bump only `package.json`, the published package reports a stale
`VERSION` at runtime — telemetry/UA/`--version` all lie, and you cannot
tell from logs which code a user is actually running. Bump **both in the
same commit**.

## Fix

Set both values to the new semver in one commit, then publish:

```bash
# 1. Bump every place the version lives (search for the old string):
grep -rn '"0.3.0"\|= "0.3.0"' package.json src/
#   package.json   →  "version": "0.4.0"
#   src/version.ts →  export const VERSION = "0.4.0";

# 2. Commit them together with the source change (do NOT --no-verify
#    past the guard — it is diagnostic, not a bypass candidate).
git add package.json src/version.ts src/client-detect.ts
git commit -m "feat(cli): detect new client family; bump 0.4.0"

# 3. Publish so npx users actually get it.
npm publish    # or your release script
```

Choosing the bump: additive, backward-compatible behavior (new flag,
new detected client, new optional output) → **minor**. Bug fix with no
API change → **patch**. Removed/renamed flag or changed default → major.
"Source changed at all" is the guard's trigger; *which* bump is your
semver judgement.

### Encode it as a pre-commit guard (the durable fix)

A one-time human mistake repeats; encode it. A guard that fires when a
tracked source file under the package changed but the `version` field did
not turns an invisible distribution bug into a loud, local, pre-publish
failure:

```bash
# pre-commit (sketch): if any staged file under the package's src/ changed
# but package.json "version" is unchanged in the same commit → block.
pkg=apps/some-tool
src_changed=$(git diff --cached --name-only -- "$pkg/src" | grep -q . && echo 1)
ver_changed=$(git diff --cached -U0 -- "$pkg/package.json" | grep -q '^\+.*"version"' && echo 1)
if [ "$src_changed" = 1 ] && [ "$ver_changed" != 1 ]; then
  echo "❌ $pkg source changed without a version bump — npx users won't get it."
  exit 1
fi
```

Extend it to assert the duplicated source constant moved too. Treat a
hook failure as a finding, not an obstacle — `--no-verify` here ships the
exact bug the hook exists to stop.

## When this does NOT apply

- **Packages consumed via the lockfile, not `npx`.** A normal dependency
  pinned in a consumer's `package-lock`/`pnpm-lock` is resolved by the
  lockfile; the consumer chooses when to bump. The "users silently get
  nothing" trap is specific to ad-hoc `npx -y <pkg>` resolution and to
  `latest`-tag installs.
- **Pre-first-publish / private internal tools never published.** If the
  package is run directly from the repo (`node ./bin`, workspace symlink),
  there is no registry copy to go stale — though a duplicated version
  constant can still drift for telemetry.
- **Build artifact, not version, is the problem.** If the published
  version *is* new but users still crash, suspect a missing build step or
  a source-only `main` — see related entries.

## Related

When a downstream user reports "my change isn't there" or a guard blocks
a source-only commit, the convention is one search away:

```typescript
search_lessons({
  query: "npx published package version bump source change never reaches users",
  tools: ["npm", "git"],
  tags: ["npx", "version-bump", "distribution"],
});
```

- [[lsn_auto_commit_package_json_review]] — package metadata changes
  deserve a manual diff before push; this is the specific case of *which*
  metadata change (version) is mandatory.
- [[lsn_typescript_ci_gate_two_layer]] — same shape of fix: a local
  pre-commit gate that mirrors the failure a later stage would enforce.
- [[lsn_pnpm_lockfile_drift_precommit_check]] — sibling pre-commit guard
  for the lockfile-drift distribution failure.
- [[lsn_workspace_runtime_values_need_built_artifact]] — adjacent
  "shipped but broken" class: version was fine, the build artifact wasn't.
- [[lsn_npx_install_prompt_corrupts_redirect]] — another `npx`-resolution
  gotcha (fresh-install prompt corrupts redirected output).
- [[lsn_verify_cli_side_effects_second_source]] — verify the publish
  actually landed (registry/`npm view <pkg> version`), don't trust the
  summary line.