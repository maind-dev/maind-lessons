---
id: lsn_pnpm_filter_no_match_silent_success
title: Diagnose "No projects matched the filters" — pnpm --filter matches package.json name, not directory, and exits 0
type: debugging_lesson
tier: community
context:
  tools: [pnpm]
  languages: []
  platforms: []
  tags: [monorepo, ci, silent-failure, verification, workspace]
summary: pnpm --filter selects by package.json name, not directory name. A non-matching filter prints "No projects matched the filters" and exits 0 — so `pnpm --filter <wrong-name> typecheck && build` reports success while having verified nothing. Confirm the filter matched by checking for actual task output, not the exit code.
problem: |
  A monorepo app lives in `apps/website/` but its `package.json` name is
  `acme-landing`. Running `pnpm --filter website typecheck` prints

      No projects matched the filters

  and exits with code 0. Any `&&`-chained build also "passes". The session
  (or CI job) concludes the change is verified — but neither typecheck nor
  build ever ran. Broken code sails through.
solution: |
  1. Filter by the package.json `name`, never by the directory name —
     check with `pnpm ls -r --depth -1` (lists all workspace package names).
  2. Verify the task RAN: real output contains the package banner
     (`> acme-landing@0.1.0 typecheck`). If you only see the prompt back,
     nothing executed.
  3. In CI, add `--fail-if-no-match` (pnpm >= 9.4) or guard with
     `pnpm ls --filter <name> --depth -1 | grep -q <name>` so a renamed
     package breaks the pipeline loudly instead of silently skipping checks.
gotchas:
  - "Exit code 0 + empty output is the failure signature — the success path always echoes the script banner."
  - "Directory name and package name drift apart easily (rebrands, scoped names like @acme/website). The filter silently stops matching after the rename."
  - "`--filter ./apps/website` (path syntax with ./) DOES match by directory — but only when run from the workspace root."
  - "The same trap exists in watch/parallel modes: `pnpm -r --filter <typo> dev` starts zero servers without complaint."
evidence: "Field incident 2026-06-12: post-refactor verification chained `pnpm --filter website typecheck && build` — both 'passed' having run nothing; the package was named differently. Caught only because the missing task banner was noticed."
last_validated_at: "2026-06-12"
---

## Full context

pnpm's filter semantics are well-documented but the failure mode is
vicious precisely because nothing fails: scripting conventions treat
exit 0 as success, and both humans and agents pattern-match a green
`&&` chain as "verified".

This belongs to the silent-success family: a tool that cannot do what
you asked reports "nothing to do" instead of an error. See
[[lsn_npx_tsc_cwd_fallback]] for the same shape with `npx tsc`, and
[[lsn_surface_silent_errors_first]] for the general diagnostic stance —
agents can pull them via `get_lesson({ id: "lsn_npx_tsc_cwd_fallback" })`.

## Verification

```sh
pnpm ls -r --depth -1          # canonical list of workspace package names
pnpm --filter <name> exec pwd  # prints the package dir IFF the filter matches
```

If the second command prints nothing, your filter selects zero packages —
fix the name before believing any check. After any "green" filtered run,
confirm the package banner (`> <name>@<version> <script>`) appears in the
output.

## When this does not apply

- Path-based filters run from the workspace root (`--filter ./apps/website`)
  match by directory and fail loudly on a wrong path.
- `pnpm -r <script>` (recursive, no filter) runs everywhere — the trap is
  specific to name-based `--filter` selectors.
- pnpm >= 9.4 with `--fail-if-no-match` turns the silent skip into a hard
  error; pipelines using that flag are safe.
