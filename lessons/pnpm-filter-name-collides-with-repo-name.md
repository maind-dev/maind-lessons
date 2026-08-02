---
id: lsn_pnpm_filter_name_collides_with_repo_name
title: "Diagnose a plausibly-green monorepo check — `pnpm --filter <repo-name>` can resolve to a nested package with that name"
type: debugging_lesson
tier: community
summary: >-
  `pnpm --filter <name>` selects by package.json name. When a nested package is
  named after the repository (a `Maind/` monorepo containing an app named
  `maind`), `--filter maind` reads like "the maind monorepo" but resolves to that
  one app. Unlike a zero-match filter this produces a real, green run with a real
  package banner — so the usual "did the banner appear?" check passes while the
  rest of the workspace was never touched. Read the absolute path in the banner,
  not its presence.
context:
  tools: [pnpm, claude-code, cursor, codex]
  languages: [typescript, javascript]
  platforms: [node]
tags: [pnpm, monorepo, workspace, silent-failure, verification, agent-instructions]
---

## Symptom

A monorepo check reports success, repeatedly, and a later recursive gate (CI, a
pre-commit hook, a sync script) fails on code the "green" runs supposedly
covered:

```
$ pnpm -F myrepo typecheck
> myrepo@0.8.3 typecheck /repo/apps/vscode-extension
> tsc --noEmit && tsc -p tsconfig.webview.json --noEmit
$                                    # exit 0, no errors

... later ...
TypeScript gate: 2 errors — commit aborted
   apps/dashboard: error TS2307: Cannot find module '…/(app)/integrations/page.js'
```

Test counts are the second tell, and they are easy to miss because they look
healthy on their own: `pnpm -F myrepo test` reported **295 passing**; the
recursive `pnpm -r test` reported **~750** across four packages. Nothing said
455 tests had never run.

## Root cause

`--filter` (`-F`) selects by the **`name` field in package.json** — never by
directory, never by repo. The trap is a naming collision:

| | |
|---|---|
| repository / directory | `Maind/` |
| root package name | `maind-monorepo` |
| `apps/vscode-extension` package name | **`maind`** |

`pnpm -F maind …` therefore reads like "the maind monorepo" to every human and
every agent, and resolves to a single VS Code extension. Confirm it in one call:

```sh
pnpm ls -r --depth -1 | grep -n "^maind"     # which package actually owns the name?
```

### Why the usual verification does not catch this

The zero-match variant of this trap ([[lsn_pnpm_filter_no_match_silent_success]])
is diagnosed by checking that a package banner appeared at all — a filter
matching nothing prints `No projects matched the filters` and exits 0.

**That check passes here.** The filter matches. A banner is printed. A script
runs. Tests pass. `--fail-if-no-match` (pnpm >= 9.4) also does not fire, because
there *is* a match. Every signal that distinguishes "nothing ran" from "something
ran" is green — the only wrong thing is *which* package ran.

The discriminating detail is the **absolute path** pnpm echoes in the banner:

```
> maind@0.8.3 typecheck /repo/apps/vscode-extension
                        ^^^^^^^^^^^^^^^^^^^^^^^^^^ a subdirectory → you filtered
```

If that path is not the workspace root, a filter narrowed the run. Read the path,
not the presence of the line.

## Fix

Use the root script or an explicit recursive run, from the workspace root:

```sh
pnpm typecheck        # if root package.json defines it as `pnpm -r typecheck`
pnpm -r test          # recursive; needed when the root has no `test` script at all
pnpm -r build
```

Check what the root actually defines before trusting a bare `pnpm <script>` — a
root missing the script fails differently than one that fans out:

```sh
node -e "console.log(require('./package.json').scripts)"
```

When you genuinely want one package, prefer the **path** form, which matches by
directory and fails loudly on a typo:

```sh
pnpm --filter ./apps/dashboard typecheck
```

## The second-order trap: the instruction file encodes the bug

The reason this survives is rarely a one-off typo. The wrong command tends to sit
in the repo's own agent-instruction file (`CLAUDE.md`, `AGENTS.md`, a README
"Required Checks" block), where it is copied verbatim by every agent and every
new contributor. In the incident above, five consecutive "green" typecheck runs
came from an agent faithfully following a documented command.

Two consequences worth acting on:

1. **When a check is suspiciously fast or quiet, verify the command before
   trusting the result** — the instruction file is evidence of intent, not of
   correctness.
2. **When you find the collision, fix the instruction file in the same change.**
   Otherwise the next agent reproduces it exactly, and the fix expires with your
   session.

A short warning next to the commands is enough:

```markdown
> WARNING: `pnpm -F <name>` filters by PACKAGE name. `<name>` here is
> `apps/<app>`, not the monorepo (root package: `<root-name>`). Check the path
> pnpm echoes.
```

## When this does not apply

- **No name collision.** If no nested package shares the repo/directory name,
  `-F <repo-name>` matches nothing and degrades to the loud-ish zero-match case
  — that is [[lsn_pnpm_filter_no_match_silent_success]], not this.
- **Deliberate single-package runs.** Filtering to one package is correct and
  fast during focused work; the trap is only in believing it covered the
  workspace. Pair it with a recursive run before committing.
- **Path-based filters** (`--filter ./apps/x`) resolve by directory and cannot
  hit this collision.
- **A recursive run that is legitimately red.** `pnpm -r` surfaces pre-existing
  failures in packages you never touched (uninstalled deps, native modules built
  against another Node version). That is a different problem —
  [[lsn_monorepo_typecheck_gate_scope_changed_packages]] covers scoping a gate
  without narrowing it by name.

Retrieve with:

```typescript
search_lessons({
  query: "pnpm filter matched wrong package monorepo check green but incomplete",
  tools: ["pnpm"],
})
```
