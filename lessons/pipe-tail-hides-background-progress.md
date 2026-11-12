---
id: lsn_pipe_tail_hides_background_progress
title: "Fix a background watcher that never fires — `| tail` withholds every line until the command exits"
type: debugging_lesson
tier: community
summary: "`tail -n` cannot know which lines are last until its input ends, so `long_cmd | tail -5` writes NOTHING while the command runs. Started in the background with a watcher on its output file, the watcher sees an empty file for the whole run: progress lines, a 'waiting for your approval' prompt or an early error never arrive. Redirect the full output to a file and filter that file live instead."
context:
  tools: [claude-code, cursor, windsurf, copilot]
  languages: [bash, shell]
  platforms: []
  tags: [agent-workflow, shell, background-tasks, monitoring, silent-failure]
---

## Symptom

An agent starts a long-running command in the background — a deploy, a merge
helper that waits for a person's approval, a test suite — and arms a watcher on
the task's output file for a line like `waiting for approval` or `FAILED`. The
watcher never fires. The output file stays at **0 bytes** for the whole run,
even though the command printed its status line within seconds. The person ends
up asking the agent whether anything is happening.

Typical command shape, written to keep the tool result small:

```bash
deploy --wait 2>&1 | tail -6        # run in the background
```

## Cause

`tail -n N` prints the last N lines — and it cannot know which lines are last
until its input reaches end-of-file. It therefore buffers everything and writes
nothing until the producer exits. Piped this way, a command that runs for 40
minutes produces 40 minutes of silence, then six lines at once. Any watcher on
the output (a `grep` loop, a monitor, a person) sees an empty file.

Two follow-on traps from the same pipe:

- The exit code reported for the task is `tail`'s (almost always 0), not the
  command's — see [[lsn_shell_pipe_breaks_command_chain_error_handling]].
- The six lines that finally arrive are the trailer; the line that mattered
  (which gate failed, which step waited) scrolled out above them.

## The fix

Send the **full** output to a file, keep the real exit status, and filter the
file live:

```bash
# run in the background
deploy --wait > /tmp/deploy.log 2>&1; echo "exit $?" >> /tmp/deploy.log

# watch — tail -F follows a growing file and prints as lines arrive
tail -n +1 -F /tmp/deploy.log | grep --line-buffered -E "waiting for|merged|FAILED|exit "
```

`tail -F` (follow) is the opposite of `tail -n`: it streams. `grep
--line-buffered` keeps the filter from batching. The appended `exit $?` line
gives the watcher a terminal event that covers every outcome, success or not.

If the tool offers a status command (`deploy status`, `approval --until
asked`), poll that instead of parsing logs at all.

## Verification

```bash
( for i in 1 2 3; do echo "line $i"; sleep 2; done ) | tail -5 > /tmp/t.log &
sleep 3; wc -c /tmp/t.log     # → 0: nothing written yet
wait;    wc -c /tmp/t.log     # → 21: everything arrives at exit
```

## When this does NOT apply

- Short commands whose output you read after they finish — `| tail` is fine
  there (mind the exit status).
- `tail -f` / `tail -F` on a file — following streams; only `tail -n` on a pipe
  holds everything back.
- Producers that are themselves block-buffered when not on a TTY (Python
  without `-u`, many C programs): redirecting to a file will not help by itself;
  use the tool's unbuffered flag or `stdbuf -oL`.

## Related

```js
search_lessons({ query: "background task watcher never fires output file empty tail pipe" })
```

- [[lsn_shell_pipe_breaks_command_chain_error_handling]] — the same pipe also
  replaces the command's exit status with `tail`'s.
- [[lsn_background_task_read_output_before_theory]] — read the output artifact
  before theorising about a silent background task.
