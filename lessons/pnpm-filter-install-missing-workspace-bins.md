---
id: lsn_pnpm_filter_install_missing_workspace_bins
title: "Fix `tsc: command not found` after filtered pnpm install with a full workspace install"
type: debugging_lesson
tier: community
lesson_class: general
quality_tier: experimental
context:
  tools: [codex, claude-code, cursor]
  languages: [typescript, javascript]
  platforms: [node]
  tags: [pnpm, monorepo, workspace, typecheck, node_modules]
summary: "A filtered `pnpm install --filter <new-workspace>...` can recreate the root `node_modules` while linking binaries only for the filtered package. The next `pnpm -r typecheck` then fails in unrelated workspaces with `tsc: command not found`."
problem: |
  After adding a new pnpm workspace package, an agent may run a filtered install
  such as `pnpm install --filter content-research-worker...` to update only the
  new package. If pnpm decides to recreate the root `node_modules` directory,
  the filtered install can leave existing workspaces without their local
  `.bin/tsc` links. The new package typechecks cleanly, but the monorepo gate
  fails later:

  ```text
  apps/mcp-bridge typecheck: sh: tsc: command not found
  packages/types typecheck: sh: tsc: command not found
  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL ... spawn ENOENT
  ```
solution: |
  Treat this as an install-state problem, not a TypeScript problem.

  1. Confirm the symptom by checking for missing workspace binaries:

     ```bash
     ls apps/mcp-bridge/node_modules/.bin/tsc packages/types/node_modules/.bin/tsc
     ```

  2. Restore the whole workspace install from the monorepo root:

     ```bash
     cd <monorepo-root>
     CI=true pnpm install --no-frozen-lockfile
     ```

     If the lockfile is already current and the package tarballs are available,
     this should mostly relink from the store. If the sandbox or CI runner blocks
     registry access, rerun with the normal network permissions for dependency
     installation rather than trying to patch individual `.bin` links by hand.

  3. Re-run the exact recursive gate that failed:

     ```bash
     pnpm -r typecheck
     ```

  Once the full install has restored workspace links, the unrelated `tsc:
  command not found` failures should disappear.
gotchas:
  - "Do not chase TypeScript errors first when every failing workspace says `tsc: command not found`; the compiler binary is missing before project code is checked."
  - "A successful `pnpm --filter <new-package> typecheck` is not proof that the monorepo install is healthy; it only proves the filtered package has its binaries."
  - "If `pnpm install --offline` reports missing tarballs after node_modules was recreated, the workspace can be left half-linked. Finish with a normal full install instead of rerunning more filtered installs."
  - "After touching package.json or pnpm-lock.yaml, manually inspect the diff and do a fresh Docker/build verification before pushing if deployment depends on a clean install."
evidence: "Observed during MAIND content-research-worker scaffold on 2026-05-25: filtered install linked the new workspace, then `pnpm -r typecheck` failed in existing packages with `tsc: command not found`; full `CI=true pnpm install --no-frozen-lockfile` restored the monorepo gate."
last_validated_at: "2026-05-25"
---

## Diagnostic pattern

This failure has a distinctive shape:

```text
Scope: 13 of 14 workspace projects
apps/content-research-worker typecheck$ tsc --noEmit
apps/mcp-bridge typecheck$ tsc --noEmit
apps/mcp-bridge typecheck: sh: tsc: command not found
packages/types typecheck: sh: tsc: command not found
```

The newly installed package may pass because its `node_modules/.bin/tsc` exists,
while older workspaces fail before TypeScript starts. That is the clue: the
recursive runner is fine, the source code is not being evaluated yet, and the
workspace install graph is incomplete.

## Safe recovery sequence

Use a full install from the monorepo root:

```bash
cd <monorepo-root>
CI=true pnpm install --no-frozen-lockfile
pnpm -r typecheck
```

`CI=true` avoids interactive prompts if pnpm needs to rebuild `node_modules`.
`--no-frozen-lockfile` is appropriate only when the session intentionally added
or changed a workspace package and the lockfile importer needs to be updated. If
no package metadata changed, prefer the repo's normal frozen install command.

## When This Does Not Apply

If `tsc` exists in each failing workspace and TypeScript reports real file or
type errors, fix the code instead of reinstalling. If `npx tsc` is running from
the wrong directory, verify the current working directory and compiler path
first; that is a different failure mode. If a deployment cannot resolve an
internal workspace package after a clean install, check whether that package
needs a build/prepare script before blaming workspace binary links.

## Why not manually recreate `.bin/tsc`?

Manual symlink repair fixes only the first missing binary you notice. A filtered
install that recreated root `node_modules` can leave many package links,
peer-dependency links, and prepare-script outputs out of sync. The robust fix is
to let pnpm rebuild the entire workspace install graph, then verify with the
same recursive command that failed.

## Related Checks

This convention is adjacent to, but distinct from:

- `lsn_npx_tsc_cwd_fallback`: wrong-CWD `npx tsc` can run the wrong compiler.
  Here `pnpm -r` is in the right CWD, but the local compiler binary is absent.
- `lsn_auto_commit_package_json_review`: package metadata changes need manual
  diff review and clean-build verification.
- `lsn_pnpm_workspace_prepare_script`: workspace packages that ship build
  artifacts need lifecycle scripts. Here the failure happens before artifact
  resolution, at workspace binary linking time.

Useful retrieval query when triaging this symptom:

```typescript
search_lessons({
  query: "pnpm recursive typecheck tsc command not found workspace node_modules",
  tools: ["pnpm"],
  languages: ["typescript"],
})
```
