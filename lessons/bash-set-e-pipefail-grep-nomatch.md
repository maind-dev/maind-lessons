---
id: lsn_bash_set_e_pipefail_grep_nomatch
title: "`set -euo pipefail` + a bare `v=$(fn)` whose pipe ends in grep: a normal no-match kills the whole script"
type: debugging_lesson
tier: community
summary: >
  Under `set -euo pipefail`, a bare command-substitution assignment `v="$(fn)"`
  takes the exit status of the substitution. If `fn` ends in a `grep ... | cut | tr`
  pipe, a legitimate "key not found" makes grep exit 1, pipefail propagates it out
  of the pipe and out of the function, and `set -e` aborts the ENTIRE script at that
  assignment — silently, with no error line. The failure surfaces far from the cause
  (often after a visibly successful step). Fix: end such pipes in `|| true`.
context:
  tools: []
  languages:
    - bash
    - shell
  platforms: []
  tags:
    - bash
    - set-e
    - pipefail
    - grep
    - command-substitution
    - deploy-scripts
    - ci
---

## Symptom

A deploy or CI script exits non-zero **with no error message**, and the exit
happens *after* a step that clearly succeeded (a build finished, a health gate
printed "OK"). A wrapper reports something like "deploy step failed" but the
underlying command left no trace. Re-running gives the same silent death; the
deployed artifact is actually fine.

## The trap

```bash
set -euo pipefail

read_env_var() {            # $1=key  $2=file  -> value, empty if absent
  [ -f "$2" ] || return 0
  grep -m1 -E "^$1=" "$2" | cut -d= -f2- | tr -d '"'
}

# ... 200 lines later, long after the real work succeeded:
v="$(read_env_var API_URL .env.local)"      # <-- script dies HERE, silently
[ -n "$v" ] || v="$(read_env_var FALLBACK_API_URL .env.local)"
```

If `.env.local` exists but has no `API_URL=` line, `grep` exits `1`. `pipefail`
makes the whole `grep | cut | tr` pipe exit `1`, so `read_env_var` returns `1`.
The **bare** assignment `v="$(read_env_var ...)"` inherits that `1`, and `set -e`
aborts the script **right there** — before the `||` fallback on the next line is
ever reached. "Key absent in this file" is a completely normal outcome, but it is
indistinguishable, to `set -e`, from a real failure.

**Why the fallback on the next line doesn't save you:** `set -e` is deliberately
suppressed for a command on the left of `||`/`&&`, in `if`/`while` conditions,
and when negated with `!`. So `[ -n "$v" ] || v="$(...)"` would be safe on its
own. But the line above it is a **bare** assignment — no such context — so
`set -e` applies in full and kills the script before the fallback ever runs.

## The fix

End any pipe whose last stage may legitimately "find nothing" with `|| true`
(or `|| :`), so a no-match yields an empty value instead of a fatal status:

```bash
read_env_var() {
  [ -f "$2" ] || return 0
  grep -m1 -E "^$1=" "$2" | cut -d= -f2- | tr -d '"' || true
}
```

Now a missing key returns empty + exit 0, the `||` fallback logic works as
intended, and the script continues.

## How to find it fast

- The signature is **"last echo prints, then silence, then non-zero exit."**
  Re-run with `bash -x script.sh 2>&1 | tail -40` — the last executed line is the
  bare `var="$(...)"` assignment, and it stops there.
- Grep the script for the pattern: a bare `^\s*\w+="\$\(` assignment calling a
  function or pipeline that ends in `grep`/`rg`/`jq -e`/`find` — anything that
  returns non-zero on "no results."
- Confirm in isolation:
  `bash -c 'set -euo pipefail; f(){ grep X /etc/hostname; }; v="$(f)"; echo reached'`
  — with the bug, `reached` never prints and `$?` is 1.

## When this does NOT apply

- **No `set -e`** (or `set +e` around the block): the assignment's status is
  ignored anyway.
- The no-match **should** be fatal (a required config key, a mandatory record):
  then let it fail — but make it *loud* (`|| { echo "missing X" >&2; exit 1; }`),
  not a silent `set -e` death 200 lines from the cause.
- The call is already in a `set -e`-suppressed context (`if`, `while`, left of
  `||`/`&&`, `!`): those don't trip. Only **bare** assignments/commands do.

## Generalization

Any command whose non-zero exit is a *normal, expected* outcome — `grep`/`rg`
(no match), `jq -e` (false/null), `find` (nothing), `diff` (differs),
`id -u user` (no such user) — is a landmine when its status can reach a bare
statement under `set -e`. Neutralize it at the point of use with `|| true`, or
branch on it explicitly (`if grep -q ...; then`). `pipefail` widens the blast
radius: it surfaces the *first* failing stage of a pipe, so a `grep | cut | tr`
pipe fails on the grep even though `cut`/`tr` succeed.

Related shell-script traps that also pass in one context and fail in another:
[[lsn_bsd_sed_no_backslash_s]] (a hook green on Linux CI, red on macOS dev) and
[[lsn_git_sync_script_branch_aware_pull]] (diagnosing a silent sync/deploy-script
failure). Find this from a symptom:
`search_lessons({ query: "bash set -e pipefail script exits silently grep no match command substitution", languages: ["bash"] })`.
