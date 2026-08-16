---
id: lsn_monorepo_split_filter_repo_refresh
title: "Splitting a monorepo with git filter-repo: fresh clones are non-destructive, and the machinery does not travel"
type: workflow_best_practice
tier: community
summary: "Split with git filter-repo on fresh --no-local clones — the source repo stays untouched by construction, and deterministic re-runs usually fast-forward the pushed split (caveat: the rewrite depends on the full ref set, so ref housekeeping between runs forks it). The bigger surprise is what does NOT travel: git hooks and core.hooksPath, CI workflows, tool configs and deploy settings all live around the code, not under the split path."
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: [git, github]
  tags: [monorepo, repo-split, filter-repo, history, secrets, migration]
---
## The premise: directory-level read access does not exist

Hosting platforms grant read access per **repository**. CODEOWNERS and branch protection govern reviews and writes, never visibility. The moment different collaborators may see different projects, a shared monorepo cannot express that — separate repos are the access-control tool, and the split is the migration. (For the baseline of each new repo, see [[lsn_new_repo_setup_baseline]].)

## Non-destructive by construction: fresh clones

`git filter-repo` refuses to run on anything but a fresh clone — lean into that:

```bash
git clone --no-local /path/to/monorepo /tmp/split/projA   # full object copy, no hardlinks
cd /tmp/split/projA
git filter-repo --path ProjA/ --path .gitignore --path LICENSE --path-rename ProjA/:
git remote add origin git@github.com:org/proj-a.git
git push -u origin master --tags
```

The source repo is never touched; filter-repo even deletes the clone's origin remote so an accidental push-back is impossible. Verify by file list, not by trust:

```bash
diff <(git -C /path/to/monorepo -c core.quotePath=false ls-files -- ProjA | sed 's|^ProjA/||' | sort) \
     <(git -c core.quotePath=false ls-files | grep -v '^\.gitignore$\|^LICENSE$' | sort)
```

## The refresh model, and its one caveat

filter-repo is deterministic: same input, same rewritten SHAs. Re-running after the monorepo moved on normally yields a history whose old tip is an **ancestor** of the new one — the refresh pushes as a plain fast-forward (measured: a 7-commit refresh landed with no force).

**But "same input" includes the ref set.** filter-repo also rewrites commit-SHA references inside commit *messages* — `(cherry picked from <sha>)` trailers, revert references — whenever the referenced commit is in the rewrite map, and that map covers every ref in the clone. Measured on a real cutover: a branch cleanup between two refreshes removed the cherry-pick source, the trailer stayed unmapped on the next run, that commit's hash changed, and the split forked from there. Either freeze ref housekeeping while previews live, or accept a final force-push — safe exactly as long as nobody has been invited.

The sequence this enables: push the splits early as previews, keep working in the monorepo, refresh at will, and treat the split repos as replaceable **until the first collaborator is invited** — that invitation is when history becomes shared ([[lsn_rebase_vs_merge_integration]]).

## What does NOT travel: the machinery around the code

A path-filtered split moves files under that path. Everything that made the monorepo *work* usually sits at its root — and silently stays behind:

| Left behind | Consequence in the new repo |
|---|---|
| `.githooks/` + `core.hooksPath` | **every pre-commit gate is gone.** `core.hooksPath` is per-clone local config that git never clones (by design — otherwise a clone could execute arbitrary code) |
| CI workflows in `.github/` | no CI at all; and once copied, every `paths:` filter and `working-directory:` still carries the old prefix |
| Repo secrets | workflows run and fail; set them per repo before judging the ported CI |
| Tool configs (`commitlint.config.*`, linters) | a config-lookup tool that finds nothing usually fails **open** — the guard is silently inert |
| Deploy settings | the platform's Root Directory still points at `Project/app/...` ([[lsn_vercel_monorepo_ignore_step_prebuild_inputs]]) |
| Shared scripts called by hooks/CI | broken references, discovered at the worst moment |

Port them deliberately, then **prove each gate fires** with a deliberately violating input — a gate never observed firing has never been tested ([[lsn_grep_q_pipefail_sigpipe_guard_inversion]]). Doing exactly that during one port surfaced a commit-message guard that had been inert since its introduction.

Two more curation items the split cannot do for you: **tags** are rewritten into every split (delete the foreign ones per split before pushing), and **renames across the project boundary** cut `git log --follow` — add old path prefixes as extra `--path` arguments if that pre-history matters. The monorepo becomes the archive: PR numbers and SHAs in docs resolve only there, so archive it read-only, never delete it.

## Gate the first invite on the history, not the tip

Inviting a collaborator shares every byte of history, not the checkout:

```bash
gitleaks git /tmp/split/projA --redact --report-path leaks.json
```

Tracked `.env` files, `.env.bak` backups and database dumps surface exactly here (measured on one split: 83 findings including live tokens and two ~100 MB SQL dumps). Rotate live credentials — after rotation the historical values are dead and may stay — or purge via `filter-repo --replace-text` / `--strip-blobs-bigger-than` during a refresh, which is still cheap while the repos are unshared.

## When this does NOT apply

- **No visibility boundary needed** → stay in the monorepo; splitting for tidiness alone trades atomic cross-project commits for nothing.
- **History not worth carrying** (young projects, prototype dirs): a plain copy + `git init` is simpler, and the archive still holds the past.
- **`git subtree split`** covers the single-branch, no-tags case without installing anything — but loses tags, other branches, and rename handling.
- **Two-way sync between monorepo and splits** is a different and painful workflow — this pattern assumes a one-way migration with a hard cutover.

```
search_lessons({
  query: "split monorepo separate repositories filter-repo history",
  platforms: ["git"],
  tags: ["repo-split"]
})
```
