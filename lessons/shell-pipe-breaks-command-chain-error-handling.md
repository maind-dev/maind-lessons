---
id: lsn_shell_pipe_breaks_command_chain_error_handling
title: "Keep the exit status when piping command output to tail — a pipe breaks the && chain and silently merges git commits"
type: workflow_best_practice
tier: community
summary: >
  A pipeline's exit status is the status of its LAST stage, so `cmd | tail && next`
  runs `next` even when `cmd` failed — and `tail -2` usually shows the trailing
  help line rather than the error. Agents write exactly this shape to keep output
  small, which turns output-trimming into silent error-swallowing. With git the
  damage compounds: a failed commit leaves its files staged, so the next `git add`
  plus commit absorbs them and two logical commits merge into one.
context:
  tools: ["claude-code", "cursor", "windsurf", "copilot"]
  languages: ["bash", "shell"]
  platforms: []
  tags: ["agent-workflow", "shell", "exit-status", "git", "silent-failure", "command-chaining"]
last_validated_at: "2026-08-19"
---

## The failure mode

An agent batches several commits into one call and trims the output so the tool
result stays small:

```bash
git add A && git commit -m "feat(x): first"  | tail -2 \
  && git add B && git commit -m "feat(y): second" | tail -2 \
  && git add C && git commit -m "docs(z): third"  | tail -2
```

The first commit is rejected by a `commit-msg` hook (commitlint, a signature
gate, a length rule). What the operator sees is a single line —
`ⓘ Get help: https://…/commitlint` — because `tail -2` kept the *trailing*
help banner and dropped the actual rule violation above it.

The chain does not stop. In POSIX shells the exit status of `a | b` is **`b`'s**
status, and `tail` succeeded, so `&&` reads the whole pipeline as success and
continues. Three things are now true at once, none of them visible:

1. The first commit does not exist.
2. Its files are **still staged** — a rejected commit does not unstage anything.
3. `git add B` adds to that same index, so the second commit contains A **and**
   B, under the second commit's message.

The result is a history where a commit quietly carries files from a scope it does
not name. Nothing in the output says so; the run looks like three commits and
produced two.

## Why this is an agent habit specifically

`| tail -n`, `| head -n`, and `| grep -c` exist in agent-written commands for a
reason: raw output is expensive in a context window, and a 400-line install log
is noise. The instinct is correct. The trap is that the *same* operator that
trims output also **replaces the status of the thing being trimmed** — so the
cheapest way to be tidy is also the cheapest way to stop noticing failures.

It compounds with `&&`-chaining, another agent habit (fewer tool calls, one
result). Chaining is what turns "I missed one error" into "every later step ran
against a state I did not verify".

## The discipline: trim output, keep status

**Redirect to a file, branch on the real status, show the tail only on failure.**
Full detail is kept for debugging, the context stays small, and a failure stops
the chain:

```bash
git commit -m "feat(x): first" > /tmp/c1.log 2>&1 \
  || { tail -20 /tmp/c1.log; echo "COMMIT FAILED"; exit 1; }
```

Three alternatives, by situation:

- **`set -o pipefail` at the head of the command string** — makes the pipeline
  report the first failing stage. One-line fix when you really want the pipe:
  `set -o pipefail; cmd | tail -5 && next`. Note it is *not* on by default in an
  ad-hoc shell, which is why the trap exists at all.
- **`${PIPESTATUS[0]}`** (bash) to read the producer's status after the pipe:
  `cmd | tail -5; [ "${PIPESTATUS[0]}" -eq 0 ] || exit 1`.
- **Do not pipe short output at all.** `git commit`, `git push`, `npm version`
  print a handful of lines. Piping them saves nothing and costs the status.

For git chains specifically, add one assertion that the state matches the
intent — it catches the merge-of-commits case even if a status slips through:

```bash
git commit -m "..." || exit 1
git diff --cached --quiet || { echo "index NOT empty after commit"; exit 1; }
```

## Detection, before and after

Before sending a chained command, scan it for a pipe whose status you then rely
on: any `| tail`, `| head`, `| grep`, `| jq` **followed by `&&`, `||`, `;
echo $?`, or an `if`**. That is the whole rule; it needs no judgement.

Afterwards, two tells are worth knowing because they appear routinely:

- A tool result showing **only a help/footer line** (`Get help: …`, `See above
  for details`, `Run with --verbose`) is a trimmed error, not a success. A
  successful command rarely ends with a support URL.
- `git show --stat <sha>` listing files from a scope the subject line does not
  mention means an earlier commit failed and its index survived. Verify with
  `git log --oneline` — a chain that reported N commits should have produced N.

## When this does NOT apply

- **The status is genuinely irrelevant.** `ls | head -5` for a look-around,
  a best-effort cleanup — nothing downstream depends on it, so nothing is lost.
- **The pipeline's last stage IS the decision.** `grep -q PATTERN` in an `if` is
  supposed to report the grep; that is the intent, not an accident. (Watch the
  inverse trap there — see the cross-reference below.)
- **`set -euo pipefail` is already in force**, e.g. inside a committed script.
  Then the pipe reports the first failure and the chain stops on its own — the
  problem is specific to ad-hoc, interactive-style command strings.
- **Deliberate continue-on-error batches.** Sometimes you want all N steps
  attempted regardless. Then use `;` rather than `&&`, and say so — the point is
  that the semantics are chosen, not inherited from a pipe.

## Related

```
search_lessons({ query: "pipe exit status tail && chain agent silent failure git commit" })
```

- [[lsn_bash_set_e_pipefail_grep_nomatch]] — the mirror image: with `pipefail`
  a *legitimate* non-zero (grep finding nothing) propagates and kills a script
  that should have continued. Read together they frame the choice: without
  pipefail failures vanish, with it normal outcomes become fatal — neither
  default is safe unattended.
- [[lsn_grep_q_pipefail_sigpipe_guard_inversion]] — the sharpest instance of that
  second direction: `producer | grep -q` under pipefail exits 141 on a MATCH, so
  the guard clears exactly when it should fire.
- [[lsn_agent_command_block_line_continuation]] and
  [[lsn_agent_recommended_commands_prompt_free]] — the same family: an agent's
  formatting or batching habit silently breaks the command it is emitting.
