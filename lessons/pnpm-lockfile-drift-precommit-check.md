---
id: lsn_pnpm_lockfile_drift_precommit_check
title: "Fix `ERR_PNPM_OUTDATED_LOCKFILE` at commit time — pre-commit-Hook with `--frozen-lockfile --offline`"
type: debugging_lesson
tier: community
summary: "Manually editing a `package.json` version specifier without running `pnpm install` leaves `pnpm-lock.yaml` out of sync. Local dev works (cached `node_modules` satisfy lookups), but Vercel/Netlify run `pnpm install --frozen-lockfile` and fail with `ERR_PNPM_OUTDATED_LOCKFILE` hours later. Catch the drift locally with a pre-commit-hook running `pnpm install --frozen-lockfile --offline --ignore-scripts` when a workspace `package.json` is staged."
context:
  tools: []
  languages: ["typescript", "javascript"]
  platforms: []
  tags: ["pnpm", "monorepo", "ci", "vercel", "pre-commit", "lockfile", "lifecycle"]
---

## Symptom and diagnostic flow

Vercel/Netlify build fails with:

```
ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because
  pnpm-lock.yaml is not up to date with <ROOT>/apps/<name>/package.json

  Failure reason:
  specifiers in the lockfile don't match specifiers in package.json:
  * N dependencies were added: <pkg>@^<version>
```

Locally, `pnpm dev` and `pnpm build` worked fine. The drift is invisible
because:

| Layer | Sees the drift? |
|---|---|
| `pnpm dev`, `pnpm build` locally | no — cached `node_modules/` satisfies imports |
| `pnpm install` (default) | no — would update the lockfile silently |
| `pnpm install --frozen-lockfile` (CI default) | **yes** — refuses to mutate the lockfile, throws `ERR_PNPM_OUTDATED_LOCKFILE` |
| `tsc --noEmit` | no — TypeScript resolves through `node_modules`, not the lockfile |

So a manual `package.json` edit + `git commit` + push reaches CI hours later,
and the build only fails when it tries to run `pnpm install --frozen-lockfile`.

To confirm the drift class once you see the error:

```bash
# 1. Which package.json changed without a lockfile follow-up?
git log -p --follow apps/<name>/package.json | head -50

# 2. Reproduce locally with the same flag CI uses:
cd <monorepo-root>
pnpm install --frozen-lockfile --offline --ignore-scripts
# expected: ERR_PNPM_OUTDATED_LOCKFILE — matches the CI failure

# 3. Resync the lockfile:
pnpm install
# (run WITHOUT --filter so all workspaces resync; --filter only touches one slice)

# 4. Commit the updated pnpm-lock.yaml.
```

If you have a maind MCP integration installed and want to find adjacent
vetted patterns before applying this fix, surface them with:

```
search_lessons({ tags: ["pnpm", "lockfile"], tier: "all" })
```

## Why this happens

Two factors compound:

1. **Manual edits feel safe.** Bumping a dependency by typing the new
   version into `package.json` is a common workflow — especially when
   a sync-script or auto-commit captures the change before anyone
   manually runs `pnpm install`. The diff looks like a one-line update,
   so the lockfile-sync requirement is easy to forget.

2. **CI uses `--frozen-lockfile` by default; local does not.** Vercel,
   Netlify, GitHub Actions and similar default to refusing to mutate the
   lockfile during install. This is correct security-wise (a stale
   lockfile is the only thing standing between malicious-dependency
   tampering and a green build) but creates a hard local/CI divergence:
   the same `pnpm install` command means two different things depending
   on where it runs.

The `--filter <pkg>` flag amplifies the trap when adopted as a
convenience habit. `pnpm install --filter @org/foo` only resolves and
records that workspace's deps in the lockfile, leaving every other
workspace's stale state untouched. A new dependency in `apps/bar`
that you didn't even touch can stay out-of-sync.

## Workaround — pre-commit-Hook

A short shell hook that mirrors the CI command exactly, but local.
Sketched for a monorepo at `<repo>/<monorepo-path>/`:

```bash
# In .githooks/pre-commit (paired with `git config core.hooksPath .githooks`):

if [ "${SKIP_LOCKFILE_CHECK:-0}" != "1" ] && [ -n "$staged" ]; then
  # Any package.json or pnpm-lock.yaml in the monorepo triggers the check.
  monorepo_path="<monorepo-path>"
  changed=$(printf '%s\n' "$staged" \
    | grep -E "^${monorepo_path}/(package\.json|pnpm-lock\.yaml|(apps|packages)/[^/]+/package\.json)$" || true)

  if [ -n "$changed" ] && command -v pnpm >/dev/null 2>&1; then
    drift_output="$(cd "<repo-root>/${monorepo_path}" && \
      pnpm install --frozen-lockfile --offline --ignore-scripts 2>&1 || true)"

    if printf '%s' "$drift_output" | grep -q "ERR_PNPM_OUTDATED_LOCKFILE"; then
      echo "pnpm-lock.yaml out of sync with staged package.json — CI will fail."
      echo "Fix:  cd ${monorepo_path} && pnpm install"
      echo "Then: git add pnpm-lock.yaml and commit again."
      echo "Bypass: git commit --no-verify  or  SKIP_LOCKFILE_CHECK=1 git commit ..."
      exit 1
    fi
    echo "pnpm lockfile-drift check: OK"
  fi
fi
```

Three flags that matter:

- **`--frozen-lockfile`** — refuse to mutate the lockfile, same as CI.
  The only flag that triggers `ERR_PNPM_OUTDATED_LOCKFILE`.
- **`--offline`** — skip network calls. Drift detection happens during
  pre-resolution (metadata compare between the in-memory lockfile and
  the workspace's `package.json` files); it does not need the registry.
  Setting `--offline` means the hook fails closed on drift even on a
  flaky network or air-gapped.
- **`--ignore-scripts`** — skip `prepare`/`postinstall`/etc. Drift
  detection happens before lifecycle scripts; skipping them keeps the
  hook fast (typical 200-800ms when the lockfile is in sync, since
  the resolution step is short-circuited to "already up to date").

Latency: 200ms-2s for an in-sync lockfile (resolution step skipped);
5-10s on genuine drift (full resolution attempted, then error thrown).
Faster than `tsc --noEmit` and faster than every CI-build-fail
debugging cycle.

## When this does not apply

- **npm or yarn projects.** They have their own lockfile-strictness
  flags (`npm ci`, `yarn install --frozen-lockfile`) and slightly
  different error messages. Same pattern, different command.
- **Mono-package projects (no workspaces).** Single-package
  `pnpm install` in default mode already syncs the lockfile; the drift
  class still exists but `--filter` is not the trap. Hook still useful.
- **CI that uses the non-frozen mode.** Some platforms override the
  default with `pnpm install --no-frozen-lockfile`. The build then
  succeeds even with drift, and the dependency version that ships is
  whatever the registry resolves at build time — which IS a tampering
  risk and a non-reproducibility risk. The better fix is to switch CI
  back to `--frozen-lockfile` and pair it with this hook.

## Related to two-layer CI gate

This hook is structurally identical to
[[lsn_typescript_ci_gate_two_layer]] — a local gate that mirrors the CI
gate so accidental bypass requires deliberate intent. The lockfile-gate
is the dependency-resolution counterpart of the typecheck-gate. Both
belong in the same `.githooks/pre-commit` script, both should have
named skip-env-vars (`SKIP_LOCKFILE_CHECK`, `SKIP_TSC_HOOK`) so a
genuine emergency bypass is targeted and traceable in the commit log.

Adjacent class: [[lsn_auto_commit_package_json_review]] — when a
sync-script captures `package.json` changes automatically, manual diff
review catches the lockfile-resync requirement before the commit. The
hook is the safety net when the review step is skipped or distracted.
