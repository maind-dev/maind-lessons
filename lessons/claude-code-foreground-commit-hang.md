---
id: lsn_claude_code_foreground_commit_hang
title: Unstick a git commit that hangs in Claude Code's foreground shell — rerun it in the background and verify via git log
type: workflow_best_practice
tier: community
context:
  tools: [claude-code, git]
  languages: [bash]
  platforms: []
  tags: [git, commit-hooks, sandbox, agent-workflow, hang]
summary: "A `git commit` in a repository with hooks can hang in Claude Code's foreground Bash call until the tool timeout, although the hooks finish in seconds standalone. Rerunning it in background mode completed in one to two minutes. Abort after about a minute, rerun in the background, and judge success by `git log`, not an exit code."
last_validated_at: "2026-09-24"
---

## Symptom

In Claude Code, a `git commit` issued through the Bash tool in the **foreground** runs until the tool's timeout (observed: 2 and 10 minutes, exit 143). The repository has git hooks (`pre-commit`, `commit-msg`). Run by hand, the same hooks finish green in seconds. There is no index lock, no GPG prompt, no stuck process. `GIT_TRACE` stops at the first `git rev-parse` *inside* the hook.

## What worked

The **identical** commit, issued with the Bash tool's `run_in_background: true`, completed in about one to two minutes — twice, on the same afternoon, in the same worktree.

The root cause was not established. The observations fit an interaction between the foreground execution mode and subprocesses spawned by the hook; that is a reading of the evidence, not a verified mechanism. The pattern first appeared after a `pnpm install` in a fresh worktree; the first commit of a session often runs normally.

## How to apply

1. Commit in the foreground as usual.
2. If it produces no output for about a minute, stop it and rerun the same command with `run_in_background: true`.
3. Verify with `git log --oneline -1` and `git status --short` — never with the exit code of a piped background command (`… | tail` reports `tail`'s status; see [[lsn_shell_pipe_breaks_command_chain_error_handling]]).

Do not keep diagnosing the foreground hang: the time goes into the timeout, and the background rerun is cheap.

## When this does NOT apply

- Repositories without git hooks.
- A commit that fails *fast* — that is a hook rejecting the commit (commitlint, a guard), not a hang. Read its message.
- A hang that also occurs when the commit is run by hand in a normal terminal — then it is the hook itself, and the background rerun hides a real problem.
