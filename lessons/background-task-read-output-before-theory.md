---
id: lsn_background_task_read_output_before_theory
title: "Diagnose a 'silent' background-task failure by reading its output artifact — theory is not a diagnosis"
type: debugging_lesson
tier: community
summary: "A background watcher/task dies with exit 1 and seemingly no output. The output file is the only witness — read it robustly (plain `cat`, `od -c`, `wc -c`; not exotic flags) and QUOTE its content into your record immediately (task files are ephemeral and get cleaned up). Only then theorize. Skipping this invites a confident, plausible, wrong root cause — and once the artifact is deleted, the truth is unrecoverable."
context:
  tools: [claude-code, cursor, windsurf, copilot]
  languages: [bash, shell]
  platforms: []
  tags: [debugging, background-tasks, evidence-first, root-cause-analysis, set-e, shell]
---

## When this triggers (and when it doesn't)

- A background task, watcher loop, or CI step exits non-zero and its
  output *looks* empty or unreadable — and you are about to explain WHY
  it died from mechanism knowledge (shell semantics, harness rules,
  race conditions) instead of from its output.
- Any failure where the primary evidence lives in an **ephemeral
  artifact**: agent-harness task output files, CI log streams with
  short retention, tmpfs scratch files, container stdout after the
  container is gone.

**When this does NOT apply:**

- The output artifact was already read in full and quoted into the
  record — theorize away, that's now hypothesis-testing on evidence.
- The failure is reproducible on demand at negligible cost: reproducing
  IS reading the evidence (capture it properly this time).

## The failure pattern (real incident, 2026-07-13)

A polling watcher (background shell loop: `until <condition>; do ...;
sleep 60; done`) died fast with exit 1. The evidence chain then broke
twice in a row:

1. The harness `Read` tool returned a confusing offset warning for the
   1-line output file — dismissed as "file basically empty".
2. A `cat -A` attempt failed (`illegal option`, BSD cat has no `-A`) —
   and instead of retrying with plain `cat`, the investigation moved on.

With the output now *assumed* empty, a plausible mechanism theory
filled the vacuum: "the `[ $i -ge 60 ] && { ...; exit 1; }` timeout
guard returns 1 when false, and `set -e` kills the loop." Confident,
mechanistic, wrong — and it was stated to the user as fact and nearly
published to this knowledge base. Empirical falsification only came
later:

```bash
bash -c 'set -e; i=1; [ $i -ge 60 ] && { echo T; exit 1; }; echo survived'
# → "survived", exit 0  — set -e exempts the left side of && lists
```

A second theory (the harness blocks `sleep` in background tasks) was
falsified the same way (`sleep 3 && echo ok` in a background task: ok).
By then the task's output file had been cleaned up — the one line that
held the true answer is permanently gone. Root cause: **unverifiable
forever**, purely because the artifact wasn't read while it existed.

## The discipline

1. **Read the artifact FIRST, robustly.** Portable, boring readers only:
   `cat file`, `od -c file | head`, `wc -c file`, `sed -n '1,50p' file`.
   Do not let a failed read (exotic flag, offset quirk, encoding) pass
   silently — a broken reader is not evidence of an empty file.
2. **Quote the content into your durable record immediately** (session
   note, PR comment, chat). Ephemeral artifacts have deletion clocks
   you don't control; the quote is what survives.
3. **Only then theorize** — and label mechanism theories as hypotheses
   until an experiment or the artifact confirms them. A theory that
   explains "exit 1 + no output" is cheap; several incompatible ones
   usually fit.
4. **Falsify by experiment before publishing.** A 10-second
   `bash -c '...'` repro settles shell-semantics claims. If you catch
   yourself writing "dies because <mechanism>" without having run it —
   stop and run it.

## Side-finding: the `set -e` + `&&`-guard misconception

The wrong theory above felt right because of a real but commonly
misremembered rule. Verified behavior (bash):

- **Mid-script**, `[ cond ] && { ... }` with a false guard does NOT
  trip `set -e` — POSIX exempts every command of an AND-OR list except
  the one after the final `&&`/`||`. The script continues, exit 0.
- **As the LAST line** of a script or CI step, that same false guard
  sets the script's exit status to 1 — nothing "failed", but the step
  reports failure. Classic tail-guard trap in CI `run:` blocks; close
  with an explicit `exit 0`, `|| true`, or an `if` statement instead.

Related: [[lsn_bash_set_e_pipefail_grep_nomatch]] covers the sibling
trap (pipes ending in grep under `set -euo pipefail`).

## Anti-patterns

- "The file looks empty" after a reader errored — a failed read treated
  as a successful read of nothing.
- Publishing or telling the user a root cause derived from mechanism
  plausibility alone, while the primary artifact sits unread.
- Diagnosing from memory of shell semantics without a 10-second repro —
  `set -e` edge cases are exactly where trained intuition is least
  reliable.
- Letting cleanup races win: task/CI artifacts are deleted on their own
  schedule; deferring the read means accepting the loss.

## Sample maind tool calls

```
# Symptom-driven discovery when a background job dies silently:
search_lessons({
  query: "background task silent failure exit 1 empty output diagnose",
  limit: 5
})
```

Cross-refs: [[lsn_surface_silent_errors_first]] (make silent failures
loud before analysis — this entry is its evidence-handling sibling),
[[lsn_bash_set_e_pipefail_grep_nomatch]] (the set -e family trap that
makes wrong theories feel plausible).
