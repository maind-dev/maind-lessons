---
id: lsn_worktree_gitignored_config_wrong_target
title: "Diagnose a CLI that writes to the WRONG project from a git worktree — the gitignored target-config is absent"
type: debugging_lesson
tier: community
summary: >
  A git worktree receives tracked files only, so a gitignored config that decides
  WHICH database/cluster/project a CLI talks to never materializes there. The CLI
  does not fail — it falls back to defaults, and default ports and profiles are
  shared by every project on the machine, so the command lands on a SIBLING
  project. The blast radius is whatever the command does, and a "repair" the CLI
  suggests is then correct for a target you did not mean.
context:
  tools: ["supabase-cli", "claude-code", "cursor", "windsurf"]
  languages: ["bash"]
  platforms: ["supabase", "postgres", "docker"]
  tags: ["git-worktree", "cli", "config-drift", "destructive-operations", "parallel-sessions", "local-dev"]
last_validated_at: "2026-08-19"
---

## Symptom

A CLI command run from a feature worktree behaves as if it were connected to a
different project — and in a strict sense it is. Observed shapes:

- `supabase migration up --local` in worktree `../repo-feature` reports remote
  ledger versions that belong to a **different repository** on the same machine.
- `supabase db reset` stops a *foreign* stack, then fails with
  `Bind for 0.0.0.0:54322 failed: port is already allocated`.
- The same command from the main checkout works perfectly.

Nothing in the output names the wrong project. The CLI is not confused about the
current directory; it is confused about the **target**, and the target is exactly
what was configured in a file the worktree does not have.

## Root cause: worktrees carry tracked files, and only those

`git worktree add` materializes the commit — tracked files. Everything in
`.gitignore` is, by construction, absent:

```bash
git -C ../repo-feature status --short          # clean
ls  ../repo-feature/supabase/config.toml       # No such file or directory
ls  ./supabase/config.toml                     # exists — in the MAIN checkout
git check-ignore -v supabase/config.toml       # supabase/.gitignore:7:config.toml
```

Most gitignored files are harmless when missing (caches, build output, editor
state). A small class is not: **config that selects the target**. If the file is
gone, the tool does not stop — it uses defaults:

| Gitignored file | What it selects | Default when absent |
|---|---|---|
| `supabase/config.toml` | local stack ports, project id | ports 54321/54322 |
| `.env` / `.env.local` | API base URL, DB URL, tenant | provider default or localhost |
| `kubeconfig` / `KUBECONFIG` | cluster + namespace | `~/.kube/config` current-context |
| `terraform.tfvars`, backend config | state backend, workspace | `default` workspace |
| `docker-compose.override.yml` | ports, volumes | the base compose ports |

### Why the default is the dangerous part

A default is not "no target" — it is **the same target for every project on the
machine**. Two repos that each run a local stack both want port 54322; whoever
started first owns it. So the fallback does not produce an error, it produces a
**neighbour**. That is what turns a missing config into a cross-project write.

In the observed incident the CLI printed a ready-to-paste repair command listing
~194 ledger versions "not found locally". Pasting it ran
`migration repair --status reverted` against the *neighbour's* ledger and deleted
those rows. The list was internally consistent — it was simply computed for a
project the operator had not chosen.

## The check that catches it, before the command

Directory is not identity. Before any **stateful** command (migrate, reset,
repair, push, apply, deploy) in a worktree, verify both the config's presence and
the target's identity — two lines, no guessing:

```bash
# 1. Does the target-selecting config exist HERE?
ls supabase/config.toml || echo "MISSING -> the CLI will use DEFAULTS"

# 2. What is actually listening on the port the CLI will use?
lsof -nP -iTCP:54322 -sTCP:LISTEN
# then make the target identify itself:
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -Atc "select count(*) from supabase_migrations.schema_migrations"
# compare against THIS repo's migration count:
ls supabase/migrations/*.sql | wc -l
```

A ledger count with no relation to your file count is the tell. The general rule:
**let the target identify itself** — port owner, project ref, cluster name,
account id — instead of inferring identity from your shell's cwd.

### If it already happened: the same list, inverted

`migration repair` only writes the ledger, never the schema, so a
`--status reverted` sweep is recoverable **as long as you still have the exact
list**. Scroll back, take the same versions, and re-assert them from the affected
project's own directory:

```bash
cd /path/to/the/PROJECT-THAT-WAS-HIT
supabase migration repair --status applied <the same versions...> --local
```

Then diff filesystem against ledger to confirm only legitimately-pending
migrations remain. Do not run this from the worktree that caused the problem —
that is the same mistake twice.

## Prevention

- **Name the files, then enforce parity.** Keep a committed manifest of
  gitignored-but-required paths (a `worktree-requirements` file, `.envrc.example`,
  a `REQUIRED_LOCAL_FILES` list) and have the worktree-creation step copy or
  symlink them. A worktree helper that creates the tree without them is only half
  a helper.
- **Make the wrapper refuse.** Any script fronting a stateful CLI should fail
  closed when the target-selecting config is missing, rather than let the default
  through:
  `[ -f supabase/config.toml ] || { echo "config.toml missing - refusing"; exit 1; }`
- **Give each project non-default ports.** If every project's config picks a
  distinct port block, the fallback lands on *nothing* instead of on a neighbour —
  an error you can read beats a write you cannot see.
- **Treat CLI-suggested repair commands as advisory**, and check which target they
  were computed for before pasting.

## When this does NOT apply

- **No worktrees.** A single checkout has its ignored files in place; this is
  specifically about trees created by `git worktree add` (and, for the same
  reason, fresh CI checkouts and a colleague's first clone).
- **The config is committed.** If the target-selector is tracked, the worktree
  gets it and the failure mode disappears — also the cheapest fix when the file
  holds no secrets.
- **Read-only commands.** `status`, `list`, `diff` against the wrong target are
  merely confusing, not damaging. The discipline is for commands that write.
- **Single-project machines.** With only one local stack, the default port is your
  own project and the fallback is harmless. It becomes dangerous the moment a
  second project exists.

## Related

```
search_lessons({ query: "worktree gitignored config CLI wrong target default port" })
```

- [[lsn_supabase_db_push_monorepo_cwd_ghost_dir]] — the sibling failure inside ONE
  repo: right project, wrong directory, and the same destructive
  `--status reverted` suggestion. Together they cover both ways a CLI ends up
  pointed somewhere you did not mean.
- [[lsn_supabase_migration_repair_verify_sql]] — `repair` writes the ledger, not
  the schema; the reason the recovery above is possible at all.
- [[lsn_gate_wrapper_stale_build_fails_closed]] — the same worktree property from
  the build-artifact side: a fresh worktree has neither `node_modules` nor
  `build/`, and a gate assuming them fails closed on its own infrastructure.
