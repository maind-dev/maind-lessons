---
id: lsn_vercel_monorepo_ignore_step_prebuild_inputs
title: "Vercel monorepo: an Ignored Build Step scoped to the app directory ships stale deploys"
type: workflow_best_practice
tier: community
summary: "Skipping builds when 'my app folder did not change' is wrong whenever prebuild reads anything outside it — shared workspace packages, or a sibling app whose manifest generates content. The skip then succeeds silently and production keeps the previous build. Derive the path list from what prebuild actually reads, test the command against real commits before setting it, and remember that Root Directory and Git connection are two independent settings."
context:
  tools: [claude-code, cursor, windsurf]
  languages: [bash]
  platforms: [vercel, nextjs]
  tags: [vercel, monorepo, ci, deployment, silent-failure, build-skip]
---
## The appealing wrong filter

Vercel's Ignored Build Step runs a command per deploy: **exit 0 = skip, non-zero = build**. In a monorepo the obvious command is "did anything in my app change?":

```bash
git diff --quiet HEAD^ HEAD -- .     # WRONG in most monorepos
```

It is wrong whenever the app's build reads anything outside its own directory — which in a workspace monorepo is the norm, not the exception:

- **Shared workspace packages** (`@org/ui`, `@org/types`) — a fix there must redeploy every consumer.
- **Root manifests** — `package.json` / lockfile changes alter the resolved dependency tree.
- **`prebuild` scripts reading a SIBLING app.** This is the one that gets missed. Measured on one repo: the marketing site's prebuild generated version badges from `apps/api/src/lib/tools-manifest.ts`, and the dashboard's prebuild packed a VSIX out of `apps/extension`. Neither app directory changes when those sources do.

The failure is silent by construction: the skip is *successful*, the deployment list shows no failure, and production keeps serving the previous build. Nothing is red — the same shape as [[lsn_surface_silent_errors_first]].

## Derive the paths from prebuild, not from intuition

Read the app's `prebuild`/`build` chain and follow every script it calls to the files it reads:

```bash
node -e "console.log(require('./apps/web/package.json').scripts.prebuild)"
grep -nE "readFile|resolve\(ROOT|join\(ROOT" scripts/generate-*.mjs
```

Then write the command with **repo-root-relative pathspecs** (`:/` magic prefix), so it behaves the same regardless of the Root Directory the command runs in:

```bash
git diff --quiet HEAD^ HEAD -- \
  ':/apps/web' ':/packages' ':/scripts' ':/package.json' ':/pnpm-lock.yaml' \
  ':/apps/api/src/lib/tools-manifest.ts'
```

Err toward building: a false build costs minutes, a false skip ships stale code.

## Test it against real commits before you set it

The command is a one-line setting with no dry-run in the UI — so run it locally against commits whose correct outcome you already know:

```bash
verdict() { [ "$1" -eq 0 ] && echo SKIP || echo BUILD; }
for sha in <docs-only> <shared-package> <sibling-app> <this-app>; do
  git diff --quiet "$sha^" "$sha" -- <paths>; echo "$sha $(verdict $?)"
done
```

A docs-only commit must SKIP; a shared-package commit must BUILD. Also check the edge: if `HEAD^` does not resolve (first commit on a branch, shallow clone) the command exits 128 — non-zero, so it builds. Fail-safe, and worth confirming rather than assuming.

Finally verify in production shape: push a commit that touches only excluded paths and confirm **no deployment is created** — not merely that one succeeded. Proving the positive case is the same discipline [[lsn_grep_q_pipefail_sigpipe_guard_inversion]] argues for on shell guards.

## Two settings, not one — when migrating a repo

Re-pointing a Vercel project at a different repository (a monorepo split, an org move) is two independent settings, and only the first is obvious:

1. **Settings → Git** — disconnect, connect the new repository.
2. **Settings → Build and Deployment → Root Directory** — still holds the OLD path.

With only step 1 done the build clones the right repo and dies with `The specified Root Directory "<old/path>" does not exist`. Everything else on the project — environment variables, domains, protection — belongs to the project, not the repository, and survives the move untouched. Verify with a throwaway branch push (a Preview deployment) rather than by promoting to production, and re-check the Ignored Build Step afterwards: its paths carry the old prefix too. The wider split checklist is [[lsn_monorepo_split_filter_repo_refresh]].

## When this does NOT apply

- **Single-app repositories** — the app directory IS the repo; the naive filter is correct.
- **No Ignored Build Step at all** — building everything on every push is never wrong, only wasteful. If your prebuild graph is hard to pin down, that is a legitimate choice.
- **Turborepo/Nx users** — `npx turbo-ignore` derives the dependency graph from the task pipeline and is a better fit than a hand-maintained path list.
- **Deploys triggered by CLI or webhook** rather than Git integration — the Ignored Build Step does not run there.

```
search_lessons({
  query: "vercel ignored build step monorepo skip stale deploy",
  platforms: ["vercel"]
})
```
