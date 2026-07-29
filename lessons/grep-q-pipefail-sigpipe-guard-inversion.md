---
id: lsn_grep_q_pipefail_sigpipe_guard_inversion
title: "Guard never fires: `… | grep -q` under `set -o pipefail` exits 141 on a MATCH"
type: debugging_lesson
summary: >-
  Under `set -o pipefail`, `if producer | grep -q PATTERN; then` fails exactly when it
  should succeed. `grep -q` exits on the first match and closes the pipe, the producer
  dies of SIGPIPE (141), and pipefail propagates that 141 as the pipeline's status — so
  the `if` reads a genuine match as "no match". Safety guards built this way clear
  precisely in the situation they exist to catch. Capture the count first
  (`n="$(producer | grep -c PATTERN || true)"`) instead.
tier: community
context:
  tools: []
  languages:
    - bash
    - shell
  platforms: []
  tags:
    - bash
    - pipefail
    - sigpipe
    - grep
    - guards
    - silent-failure
---

## Symptom

A guard that is supposed to stop a destructive step waves it through:

```bash
set -euo pipefail

if ps -Ao comm= | grep -qF "$APP/Contents/"; then
  echo "app is running — refusing"; exit 1
fi
do_the_destructive_thing        # runs even though the app IS running
```

The app is running. `ps` lists it. Running the same `grep` by hand finds 13
matching lines. The guard still does not fire — and it will *never* fire, because
it is broken in exactly one direction: **the match case.** A guard that only works
when there is nothing to guard against reads, from the outside, like a guard that
works.

## Why

Three ordinary behaviours combine into an inversion:

1. `grep -q` is specified to exit **immediately** on the first match. It does not
   drain its input.
2. The producer (`ps`, `cat`, `find`, `curl`) keeps writing into a pipe whose read
   end is now closed, gets `SIGPIPE`, and dies with status **141**.
3. `set -o pipefail` makes the pipeline's status *the rightmost non-zero status*.
   That is the producer's 141 — not `grep`'s 0.

So the pipeline exits non-zero, `if` treats non-zero as false, and the branch is
skipped. With **no** match, `grep -q` reads to EOF, the producer exits 0, `grep`
exits 1, the pipeline is 1 — also false. Both outcomes are false: the condition can
never be true.

All outputs below are verified, not illustrative (bash 3.2, macOS 15):

```bash
# The inversion — every process matches ".", yet the branch is skipped
bash -c 'set -euo pipefail; if ps -Ao comm= | grep -q .; then echo hit; else echo MISS; fi'
# → MISS

# `set -e` is NOT the cause: pipefail alone is enough
bash -c 'set -uo pipefail;  if ps -Ao comm= | grep -q .; then echo hit; else echo MISS; fi'
# → MISS

# Same pipeline without pipefail — correct
bash -c 'set -eu;           if ps -Ao comm= | grep -q .; then echo hit; else echo MISS; fi'
# → hit

# The status itself, which is the whole story
bash -c 'set -o pipefail; ps -Ao comm= | grep -q .; echo "status=$?"'   # → status=141
bash -c '                 ps -Ao comm= | grep -q .; echo "status=$?"'   # → status=0
```

141 is `128 + 13` — SIGPIPE. It is the *producer's* status, surfaced by pipefail.

### Why it is flaky (and therefore survives review)

SIGPIPE only fires if the producer is **still writing** when `grep -q` exits. A
producer whose entire output fits in the pipe buffer (tens of KiB, OS-dependent)
finishes before the close and exits 0 — the pipeline then returns `grep`'s 0 and the
guard works:

```bash
bash -c 'set -euo pipefail; if echo hallo | grep -q hallo; then echo hit; else echo MISS; fi'
# → hit    — small producer, no SIGPIPE, guard correct
```

So the bug depends on output size and on where the match sits: a match near the end
of short output behaves correctly, a match near the start of long output inverts.
`ps -A` on a busy machine is comfortably past the threshold; a two-line fixture in a
unit test is not. This is why it passes the quick check and fails in production.

## The fix

Do not let a short-circuiting consumer decide a pipeline's status. Capture the
count, then branch on the value:

```bash
n="$(ps -Ao comm= | grep -cF "$APP/Contents/" || true)"
if [ "$n" -gt 0 ]; then
  echo "app is running ($n processes) — refusing"; exit 1
fi
```

`grep -c` reads to EOF, so the producer never sees SIGPIPE. The `|| true` covers the
legitimate zero-match exit 1 (see [[lsn_bash_set_e_pipefail_grep_nomatch]] for that
sibling trap, where a no-match under `set -e` kills the whole script).

Other workable forms:

```bash
# Scope pipefail off for just this test
if (set +o pipefail; ps -Ao comm= | grep -qF "$needle"); then ...

# Materialise first — also better when you want the matches in the message
matches="$(ps -Ao comm= || true)"
if grep -qF "$needle" <<<"$matches"; then ...
```

Prefer the count form: it survives a later refactor that adds `set -o pipefail`
higher up, and it gives you a number to put in the error message.

## When this does NOT apply

- **No `pipefail`.** Plain `set -eu` leaves the pipeline's status as the *last*
  command's — `grep -q`'s 0 — and the guard is correct. This is why the idiom is
  ubiquitous and mostly harmless; it only turns on you once someone adds `pipefail`
  to the top of the script.
- **`grep` is the producer**, not the consumer (`grep -q pat file`). No pipe, no
  SIGPIPE.
- **Bounded, small producers**: `echo`, a `printf`, a short `git config --get`. Their
  output fits the pipe buffer, so they exit before the close. Still worth rewriting —
  "small today" is not a property the next editor will preserve.
- **You want first-match short-circuit for performance** over a genuinely huge or
  infinite producer. Then keep `grep -q`, but take the status out of the pipeline:
  `producer | grep -q pat && found=1 || found=0` inside a `set +o pipefail` scope.

## The wider rule: a guard that falsely clears is worse than no guard

The reason this cost real damage rather than a puzzled minute is that the failure
direction is the dangerous one. A guard that falsely *blocks* is discovered within
seconds — someone is stopped and investigates. A guard that falsely *clears* is
never discovered, because its output is indistinguishable from "all good": it
manufactures exactly the confidence needed to proceed into the thing it was meant to
prevent.

Two working rules follow:

1. **Test a guard in the environment it runs in.** Verifying this one in a
   `bash -c` *without* `pipefail` returned "works" and confirmed the opposite of the
   truth. The shell options at the top of the script are part of the guard.
2. **Prove the positive case, not the negative one.** "It didn't fire and nothing
   was running" is not evidence. Arrange the condition, run the guard, and require it
   to fire — a guard never observed firing has never been tested.

## Related

- [[lsn_bash_set_e_pipefail_grep_nomatch]] — the sibling: under `set -euo pipefail`,
  a pipe ending in `grep` with a legitimate **no-match** aborts the entire script at
  a bare assignment. Same two options, opposite input, opposite damage.
- [[lsn_surface_silent_errors_first]] — the general principle this is an instance of.
- Verify against the current entry rather than training memory: both cross-referenced
  entries carry their own `last_validated_at`.

Find it from the symptom:

```
search_lessons({ query: "bash guard never fires grep -q pipefail SIGPIPE 141", languages: ["bash"] })
```
