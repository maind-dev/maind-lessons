---
id: lsn_0004_npx_tsc_wrong_cwd_silent_zero_errors
title: "`npx tsc --noEmit` from the wrong CWD silently reports 0 errors (resolves to a non-TypeScript tsc binary)"
type: debugging_lesson
tier: community
context:
  tools: [npm, npx, typescript, claude-code]
  languages: [typescript]
  platforms: [macos, linux]
  tags: [tooling, typecheck, false-negative, cwd-drift, agent-workflow]
summary: "Running `npx tsc --noEmit` outside of a directory whose `node_modules` contains TypeScript silently falls back to whichever `tsc` is on PATH (often the LaTeX `tsc` from MacTeX), which produces no `error TS####` lines. A naive `grep -c 'error TS'` returns 0 and a CI/agent script confidently reports 'typecheck clean' even though there are real errors."
problem: |
  An agent running typecheck-as-quality-gate emits this sequence:
  1. `npx tsc --noEmit` from `~/Projects` (the workspace root, not the app directory)
  2. exit code 0, no obvious error output
  3. agent reports "typecheck passed, 0 errors"

  In reality the workspace root has no local `typescript` install, so `npx`
  resolves `tsc` from PATH, which on developer machines with a TeX installation
  points to `/Library/TeX/.../tsc` (the LaTeX TeX-and-Spell-Check tool). That
  binary prints a different banner like `This is not the tsc command you are
  looking for` and exits 0. No `error TS` line is emitted, so any pattern
  match misses, and the gate reports clean.

  The trap is the silence. There is no thrown exception, no missing-binary
  warning, no `command not found`. Just a green light over a dirty repo.
solution: |
  Use one of these always-loud alternatives instead of bare `npx tsc`:

  1. **`npm run typecheck`** with a script that pins the binary:
     ```json
     // package.json
     {
       "scripts": {
         "typecheck": "tsc --noEmit"
       }
     }
     ```
     `npm run` requires being inside a directory whose `package.json` defines
     the script — it fails loudly with `Missing script: "typecheck"` if the
     CWD is wrong.

  2. **Direct binary path** — fails hard if absent:
     ```bash
     ./node_modules/.bin/tsc --noEmit
     ```

  3. **`npx --no-install`** — refuses to fall back to PATH:
     ```bash
     npx --no-install tsc --noEmit
     ```
     If the local install is missing, this errors with `npm ERR! could not
     determine executable to run` instead of silently using a stranger.

  4. **Sanity-check the binary explicitly** before relying on the exit code:
     ```bash
     node_modules/.bin/tsc --version
     # Version 5.x.y  ← expected
     ```

  In agent / automation contexts, always `cd` to the package directory
  *immediately before* invoking the typecheck:
  ```bash
  cd path/to/app && npm run typecheck
  ```
  rather than relying on the shell CWD persisted from earlier commands.
gotchas:
  - "On macOS with MacTeX installed, `which tsc` outside any node project frequently resolves to `/Library/TeX/.../tsc`. The wrong-tsc banner goes to STDOUT, but a `grep 'error TS'` still matches nothing."
  - "Treating exit code 0 as 'clean' is the trap. The wrong tsc exits 0 even though it never typechecked anything. Always pair the exit code with a count of files actually checked, or with `tsc --version` first."
  - "Agents and long-running shells can drift their CWD between tool calls. After any `cd` step or after long pauses (sub-agent runs, watch loops), re-anchor with an explicit `cd` before invoking tsc."
  - "Don't fix this by adding `set -e` alone — `set -e` doesn't help when the wrong binary exits 0."
evidence: "Reproducible on macOS with MacTeX installed and Node 20+. The TeX `tsc` binary is /usr/local/texlive/<year>/bin/<arch>/tsc."
last_validated_at: "2026-05-05"
tool_versions:
  typescript: "5.x"
  npm: "10.x"
upvotes: 0
---

# Background

`npx <bin>` has two modes: if `<bin>` is in the local `node_modules/.bin`,
use that; otherwise resolve from PATH. The fallback is convenient — it lets
you run rarely-used CLIs without installing them — but it is exactly the wrong
default for a quality gate. A typecheck script must run *the project's*
TypeScript, not whatever happens to be named `tsc` on the developer's
machine.

This bites coding agents particularly hard, because the wrong binary's exit
code masks the failure. The agent observes `exit 0`, sees no
`error TS####` lines in the output, and reports success. The user only
notices when the next step (build, test, deploy) hits a real type error
that "shouldn't be there."

## Pattern for agent-driven repos

For any quality gate an agent runs unattended, prefer:

```bash
# ✓ loud
cd <package-dir> && npm run typecheck

# ✓ loud, no script needed
cd <package-dir> && ./node_modules/.bin/tsc --noEmit

# ✗ silent under PATH-fallback
npx tsc --noEmit
```

A pre-commit hook should additionally `pwd` and `tsc --version` once at the
start of the run, fail-fast on any unexpected location, and only then run
the actual typecheck. Two extra seconds buys you a non-bypassable signal.

## Why this is a recurring class of bug

The same failure mode applies to anything else `npx` can find on PATH —
`prettier`, `eslint`, `vitest`, `jest`, `tsc`, `tap`. Whenever you would
write `npx <bin>` inside a CI step, harden it with one of:
- `npm run <script>` (depend on the project script)
- `./node_modules/.bin/<bin>` (depend on local install)
- `npx --no-install <bin>` (refuse PATH fallback)

Treat "no error output" as a less reliable signal than "the right binary
ran." `tsc --version` printed in the log gives you both.
