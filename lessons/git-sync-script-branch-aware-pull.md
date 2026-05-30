---
id: lsn_git_sync_script_branch_aware_pull
title: "Diagnose sync-script `fatal: couldn't find remote ref` — make pull branch-aware via upstream-probe"
type: debugging_lesson
tier: community
context:
  tools: [claude-code, cursor, windsurf]
  languages: [bash]
  platforms: []
  tags: [git, sync-script, branch-awareness, automation, upstream-tracking, daily-driver]
summary: "Daily-driver git-sync scripts that hardcode `git pull` fail with `fatal: couldn't find remote ref <branch>` the moment the working copy is on a non-master branch with no upstream. A robust sync-script probes `git rev-parse --abbrev-ref @{u}` first — branches without upstream get a warning + policy-dispatch (skip / prompt / push-with-upstream), never a fatal abort that breaks the entire sync pipeline."
problem: |
  A solo-developer or multi-repo workspace has a daily-driver sync-script
  — `./scripts/git-sync.sh`, `git_synch_Projects.py`, a `make sync`
  target, a cron job. The script's pull step is a hardcoded `git pull`.
  Works fine while the working copy stays on master.

  The moment the working copy is on a different branch (e.g. a topic
  branch created in a previous session, a quick `git switch -c` that
  was never pushed, an experiment), the sync fails:

  ```
  fatal: couldn't find remote ref test/feature-x
  ```

  The entire sync pipeline stops. Worse: the user often doesn't
  remember why the branch exists, because it was created in a context
  they've since lost (a previous AI-agent session, a Tuesday-evening
  experiment, a hotfix that got abandoned mid-flight).

  The root cause isn't the orphan branch — branches without upstream
  are legitimate. The root cause is the sync-script assuming every
  branch has an upstream. The fix is in the script, not in the user's
  branch hygiene.
solution: |
  Replace the hardcoded `git pull` in the sync-script with a four-step
  pre-flight that handles all the edge cases git can throw at it:

  **Step 1: Refuse pulls in user-driven states** (detached HEAD,
  mid-rebase, mid-merge). Pulling onto detached HEAD is almost never
  what the user means; pulling mid-rebase silently overwrites the
  rebase state.

  **Step 2: Detect the current branch + probe for upstream tracking.**

  ```bash
  current_branch=$(git rev-parse --abbrev-ref HEAD)
  upstream=$(git rev-parse --abbrev-ref "@{u}" 2>/dev/null) || upstream=""
  ```

  If `upstream` is non-empty, the happy path applies — `git pull --ff-only`.

  **Step 3: Dispatch by policy when no upstream exists.** Three
  reasonable policies:

  - `SKIP_NO_UPSTREAM` — silently skip pull, sync continues with local
    state. Right for cron jobs and CI batch-sync where interactivity
    is impossible.
  - `PROMPT_NO_UPSTREAM` — ask the user: skip / switch-to-default /
    push-with-upstream. Right for solo-dev daily-driver scripts.
  - `AUTO_PUSH_UPSTREAM` — auto `git push -u origin <branch>`. Right
    only for solo-dev workflows where every orphan branch is meant to
    become a tracked feature branch.

  **Step 4: Prefer `--ff-only` over plain pull.** This keeps history
  clean and prevents silent merge commits in the sync-script's commit
  log. If the pull would need a merge, the script aborts with a
  recognizable error instead of producing a `Merge branch 'master' of
  ...` commit the user didn't author.

  The full bash skeleton (drop-in ready):

  ```bash
  #!/usr/bin/env bash
  # branch-aware sync-pull with safe upstream-fallback
  set -euo pipefail

  POLICY="${SYNC_POLICY:-PROMPT_NO_UPSTREAM}"
  DEFAULT_BRANCH="${SYNC_DEFAULT_BRANCH:-main}"

  current_branch=$(git rev-parse --abbrev-ref HEAD)

  if [[ "$current_branch" == "HEAD" ]]; then
    echo "❌ Detached HEAD — refusing to pull." >&2; exit 1
  fi
  if [[ -d "$(git rev-parse --git-dir)/rebase-merge" ]] || \
     [[ -d "$(git rev-parse --git-dir)/rebase-apply" ]]; then
    echo "❌ Rebase in progress." >&2; exit 1
  fi
  if [[ -f "$(git rev-parse --git-dir)/MERGE_HEAD" ]]; then
    echo "❌ Merge in progress." >&2; exit 1
  fi

  if upstream=$(git rev-parse --abbrev-ref "@{u}" 2>/dev/null); then
    echo "✅ '$current_branch' tracks '$upstream' — pulling (ff-only)."
    git pull --ff-only
    exit 0
  fi

  case "$POLICY" in
    SKIP_NO_UPSTREAM)
      echo "⚠️  '$current_branch' has no upstream — skipping pull."
      exit 0
      ;;
    PROMPT_NO_UPSTREAM)
      echo "⚠️  '$current_branch' has no upstream."
      echo "    1) Skip   2) Switch to $DEFAULT_BRANCH   3) Push -u"
      read -r -p "Choice: " c
      case "$c" in
        1) exit 0 ;;
        2) git switch "$DEFAULT_BRANCH" && git pull --ff-only ;;
        3) git push -u origin "$current_branch" ;;
        *) exit 1 ;;
      esac
      ;;
    AUTO_PUSH_UPSTREAM)
      git push -u origin "$current_branch"
      ;;
  esac
  ```

  Port to Python / Node: the control flow is identical, only the I/O
  glue changes. `subprocess.run(["git", "rev-parse", "--abbrev-ref", "@{u}"])`
  in Python, `execSync("git rev-parse --abbrev-ref @{u}")` in Node.
gotchas:
  - "`git rev-parse --abbrev-ref @{u}` writes to stderr when there's no upstream. Redirect stderr (`2>/dev/null`) or you'll spam logs on every sync of an orphan branch."
  - "Bash's `set -euo pipefail` interacts with the upstream-probe: the probe uses `||` to handle the error case, but without `set +e` around it (or the `if upstream=...; then` pattern shown above), `set -e` will abort on the missing-upstream condition. The pattern in the skeleton handles this correctly."
  - "`--ff-only` will fail with a non-zero exit if the local branch has commits the remote doesn't AND the remote has new commits — i.e. divergent. Sync-scripts that need to handle this should `set +e` around the pull and check the exit code, then either skip or escalate to the user."
  - "Cron jobs running the PROMPT policy will block forever waiting for stdin. Always set `SYNC_POLICY=SKIP_NO_UPSTREAM` for non-interactive contexts. Belt-and-braces: detect non-TTY (`[[ -t 0 ]]`) and force-skip if so."
  - "Pre-pull hooks that mutate the working tree (e.g. auto-formatters running on `post-checkout`) break `--ff-only` because the working tree is no longer clean. Either skip those hooks for sync-pulls or switch to `--rebase` in their stead."
last_validated_at: "2026-05-28"
---

## Symptoms that map to this convention

| Symptom | Likely cause |
|---|---|
| Sync-script log shows `fatal: couldn't find remote ref` | Hardcoded `git pull` on a branch without upstream |
| Sync works on master, fails on feature branches | Script never probes for upstream — assumes master |
| Cron sync job stops running silently | Interactive prompt blocking forever on non-TTY |
| Sync's last log line is a merge commit you didn't author | Plain `git pull` without `--ff-only` produced an auto-merge |

## Three policies — when to pick which

| Policy | Context | User experience |
|---|---|---|
| `SKIP_NO_UPSTREAM` | Multi-repo cron, CI batch, non-interactive automation | Silent skip with log line; sync pipeline continues |
| `PROMPT_NO_UPSTREAM` | Solo-dev daily-driver, manual invocation | Interactive choice per occurrence |
| `AUTO_PUSH_UPSTREAM` | Solo-dev workflows where orphan = always tracked | Auto `push -u origin <branch>` makes the orphan a tracked branch |

For daily-driver sync-scripts that a developer runs manually,
`PROMPT_NO_UPSTREAM` is the safest default — the user sees what's
happening and picks per situation.

## The four pre-flight checks

```bash
# 1. Refuse detached HEAD
[[ "$(git rev-parse --abbrev-ref HEAD)" == "HEAD" ]] && exit 1

# 2. Refuse mid-rebase
[[ -d "$(git rev-parse --git-dir)/rebase-merge" ]] && exit 1
[[ -d "$(git rev-parse --git-dir)/rebase-apply" ]] && exit 1

# 3. Refuse mid-merge
[[ -f "$(git rev-parse --git-dir)/MERGE_HEAD" ]] && exit 1

# 4. Probe upstream — only pull when one exists
git rev-parse --abbrev-ref "@{u}" >/dev/null 2>&1 || handle_no_upstream
```

Each of these takes microseconds; the cumulative pre-flight cost is
imperceptible compared to the pull itself. The payoff is that every
edge case git can throw at the sync-script is handled gracefully
instead of producing a fatal abort.

## When this does NOT apply

- **Single-repo, single-branch workflows** where master is the only branch ever touched. The added complexity is not worth it. Stick with `git pull`.
- **Repos with mandatory feature-branch + always-push workflows** enforced by a pre-push hook or CI gate. The orphan-branch state should never persist long enough to hit the sync-script, so the upstream-probe rarely fires.
- **CI pipelines that always start from a fresh checkout.** They don't carry orphan state across runs, so the failure mode doesn't materialize.

## Verification after wiring this in

```bash
# Smoke test 1: pull works on master (happy path)
git switch main && ./scripts/git-sync.sh

# Smoke test 2: the no-upstream path triggers correctly
git switch -c test-no-upstream
./scripts/git-sync.sh   # should hit policy branch, not fatal abort
git switch main && git branch -D test-no-upstream

# Smoke test 3: detached-HEAD refusal
git checkout HEAD~1     # detaches HEAD
./scripts/git-sync.sh   # should refuse, exit 1
git switch main         # back to a real branch
```

If all three behave as expected (and previously test 2 would have
produced a `fatal: couldn't find remote ref`), the script is robust.

## Discovering related conventions

```typescript
// Orphan branches the sync-script just refused to pull on — how to clean them up:
search_lessons({ query: "orphan branch recovery ff-merge", tools: ["git"] });

// Sync-scripts often grow into multi-repo workspaces — pattern guide:
search_lessons({ query: "cross-project sync script pattern" });
```

[[lsn_orphan_local_branch_recovery]] is the recovery recipe for branches the
sync-script just refused to pull on.