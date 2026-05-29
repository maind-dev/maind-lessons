---
id: lsn_cross_project_sync_script_pattern
title: Cross-project sync-script pattern — when a personal multi-repo committer earns its keep
type: workflow_best_practice
tier: curated
summary: When you actively maintain ≥3 repos and accumulate small drift across them daily, a personal sync-script with typecheck gate, dry-run, force-flag and opt-in push beats per-repo manual commits. The skeleton is ~30 lines of Python; the value is in the gates, not the loop.
context:
  tools: [claude-code, cursor, windsurf]
  languages: [python, bash]
  platforms: []
  tags:
    - sync-script
    - multi-repo
    - workflow
    - pre-commit-gate
    - personal-tooling
last_validated_at: "2026-05-21"
---

## When this earns its keep (and when it doesn't)

A cross-project sync-script earns its keep when:

- **≥3 repos actively maintained** in parallel (workspace, vault, dotfiles,
  side-projects). The break-even is roughly 5 minutes/day of saved
  manual `cd` + `git status` + `commit` per repo.
- **Fragmented commit cadence** — small drift accumulating multiple
  times per day across repos (config tweaks, doc updates, sync of
  generated artifacts).
- **Cross-repo consistency wishes** — same conventional-commits style,
  same typecheck-gate discipline, same push-timing.

**When this does NOT apply:**

- 1-2 repos — overhead exceeds benefit; manual is fine.
- Mixed languages with mixed CI gates — the script's gate-config
  becomes a maintenance burden. Per-repo Makefiles scale better.
- Teams >5 — PR-review flow is more robust than individual sync
  scripts; sync-script artifacts (`chore(sync): update N files`)
  pollute the team's commit history.
- Monorepos — already internally cross-project; no sync needed.

## Building blocks

A sync-script is a thin orchestrator. Five blocks matter:

1. **Project list** — explicitly configured or auto-discovered under
   a parent directory. Explicit is more predictable; auto-discovery
   makes onboarding new repos zero-config.
2. **Per-project gate** — typecheck / lint / test before staging,
   per [[lsn_typescript_ci_gate_two_layer]]. A gate failure skips
   the repo unless force-overridden.
3. **Commit-message hygiene** — Conventional Commits enforced;
   the default `chore(sync): update N files` template is intentionally
   plain so the user reaches for a real message on feature work.
4. **Force / dry-run / push flags** — `--force` to bypass gates with
   a logged warning, `--dry-run` to preview diffs without committing,
   `--push` opt-in (never default — push is the loud operation).
5. **Status output** — one line per repo (skipped / dry-run /
   committed / pushed), so the operator can audit at a glance.

## Minimal Python skeleton (~30 LOC)

A starting point — adapt the `PROJECTS` list, the `GATES` mapping,
and the commit-message template. Keep it short; complexity here ages
poorly.

```python
#!/usr/bin/env python3
"""Cross-project sync-script skeleton. Adapt project list + gates."""
import argparse, subprocess
from pathlib import Path

PROJECTS = [Path(p).expanduser() for p in [
    # "~/Projects/project-a", "~/Projects/project-b",
]]
GATES = {  # project-name → shell command (run from project dir)
    # "project-a": "pnpm typecheck",
}

def run(cmd, cwd):
    return subprocess.run(cmd, shell=True, cwd=cwd,
                          capture_output=True, text=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="skip gates")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()
    for proj in PROJECTS:
        name = proj.name
        if not args.force and name in GATES:
            g = run(GATES[name], proj)
            if g.returncode:
                print(f"[{name}] gate FAIL — skipping. Use --force to override.")
                continue
        status = run("git status --porcelain", proj).stdout.strip()
        if not status:
            continue
        if args.dry_run:
            print(f"[{name}] would commit:\n{status}")
            continue
        run("git add -A", proj)
        n_files = len(status.splitlines())
        run(f'git commit -m "chore(sync): update {n_files} files"', proj)
        if args.push:
            run("git push", proj)
        print(f"[{name}] committed {n_files} files{' + pushed' if args.push else ''}")

if __name__ == "__main__":
    main()
```

## Pitfalls

- **Commit-message-quality drift** — every commit becomes
  `chore(sync): update N files` and semantic meaning disappears
  from the log. Mitigation: use the sync-script only for
  docs/config drift; commit feature work manually with a real
  message.
- **Gate-bypass habituation** — `--force` used routinely defeats
  the gate. Mitigation: log every `--force` invocation to an
  audit file; warn above a threshold (e.g. >3 forces/week).
- **Auto-push without review** — dangerous when the diff might
  include secrets or large blobs. Default `--push` OFF; opt-in
  per run.
- **Cloud-sync on `.git/objects/`** — iCloud / OneDrive can
  evict pack files, leaving `git fsck` reporting thousands of
  broken links. Keep the repo out of cloud-sync scope, or
  exclude `.git/` from sync.
- **No staged file detection** — `git status --porcelain` shows
  unstaged + staged; if a parallel session already staged
  something, the sync-script grabs it too. Add a check for
  in-progress merges (`.git/MERGE_HEAD`) before staging.

## Composition with CI

The sync-script is local convenience tooling — CI is the load-bearing
gate. Anything the sync-script's gate catches, CI should catch too.
The sync-script saves the round-trip; it doesn't replace CI.

## Sample maind tool calls

```
# Before writing your own sync-script, check for the gate pattern:
get_lesson({ id: "lsn_typescript_ci_gate_two_layer" })

# When recommending a sync-script to a user with N repos:
search_lessons({
  query: "multi repo workflow sync script gate",
  limit: 5
})
```

Cross-refs: [[lsn_typescript_ci_gate_two_layer]] (the per-project
gate detail), [[conv_repo_readiness_baseline]] (the multi-repo
workspace cue), [[lsn_new_repo_setup_baseline]] (repo baselines
the sync-script assumes).
