---
id: lsn_npx_install_prompt_corrupts_redirect
title: "Fix `npx <tool> > file` output corrupted by install-prompt — pass `--yes` or use `pnpm exec`"
type: debugging_lesson
tier: community
summary: |
  When `npx some-tool > output-file` runs and the package isn't in the
  npx cache, npx prints "Need to install the following packages: ... Ok
  to proceed? (y)" to STDOUT. The `> file` redirect captures the prompt;
  if nothing answers `y`, npx aborts and the real tool never runs —
  output contains only the prompt. `2>/dev/null` doesn't help (pollution
  is on stdout). Fix: `npx --yes <tool>` or install locally and use
  `pnpm exec`.
context:
  tools: []
  languages:
    - bash
    - typescript
  platforms: []
  tags:
    - npx
    - shell-redirection
    - destructive-output
    - codegen
    - non-interactive
---

## How to spot it

The corrupted file is almost always exactly three lines:

```
Need to install the following packages:
<package>@<version>
Ok to proceed? (y) 
```

Plus optionally a trailing whitespace line. Any redirect target with
this exact opening is a smoking gun. `git diff` typically shows
`+3/-N` where N is the file's previous line count.

## Why `2>/dev/null` doesn't save you

npx writes the install-confirmation to **stdout**, not stderr. That
is unintuitive (interactive prompts usually go to stderr in well-
behaved CLI tools), but it's how npm/npx have behaved for years. Your
`2>/dev/null` only silences `stderr`; the prompt still lands in `stdout`,
which is exactly where you redirected.

Verify on your machine:

```bash
# Force fresh install (no cache hit):
npm cache clean --force
npx supabase --version > /tmp/test-out.txt 2> /tmp/test-err.txt
cat /tmp/test-out.txt   # contains the prompt
cat /tmp/test-err.txt   # empty or minimal
```

## The two fixes

### A. Pass `--yes` to npx

```bash
npx --yes <tool> ... > "$OUTPUT.tmp" 2>/dev/null
```

`--yes` auto-confirms the install. The actual tool runs, the prompt
never appears in stdout. Equivalent: `-y` or env-var `npm_config_yes=true`.

### B. Install the tool locally (preferred for repeated use)

```bash
pnpm add -D <tool>           # or npm install --save-dev / yarn add -D
pnpm exec <tool> ... > "$OUTPUT.tmp" 2>/dev/null
```

No npx in the chain — no prompt possible. Faster (no resolution
overhead per invocation) and version-locked in `package.json` /
lockfile.

## Defense-in-depth: sanity-check before `mv`

Both fixes leave a residual risk (network blip, partial download).
Pattern-match: redirect to `.tmp`, validate first content line, then
atomic rename:

```bash
#!/bin/bash
set -e
OUTPUT="path/to/file.ts"
npx --yes <tool> ... > "$OUTPUT.tmp" 2>/dev/null

FIRST_LINE=$(grep -m 1 -v "^$" "$OUTPUT.tmp")
case "$FIRST_LINE" in
  export*|import*|type*) ;;
  *)
    echo "ERROR: output doesn't look like code:"
    echo "  $FIRST_LINE"
    rm "$OUTPUT.tmp"
    exit 1
    ;;
esac

mv "$OUTPUT.tmp" "$OUTPUT"
```

If the tool's output isn't TypeScript, adapt the first-line check
(e.g. for SQL output, expect `--` or `CREATE`).

## When you've already corrupted the file

```bash
# Most reliable: restore from last commit
git restore HEAD -- path/to/file

# Or, if not yet committed and you have a backup:
cp path/to/file.bak.<timestamp> path/to/file

# Or, regenerate via the corrected command:
npx --yes <tool> ... > path/to/file.tmp 2>/dev/null && mv path/to/file.tmp path/to/file
```

Don't commit the corrupted version — the diff (`+3/-many`) makes
the regression obvious in code-review or pre-commit type-check
gates.

## When this does NOT apply

- **npx call that doesn't redirect to a file.** Interactive use is
  fine; the prompt is meant for you to answer. The corruption only
  happens when the prompt-stdout gets captured by a redirect.
- **npx cache is warm.** If the requested package version is already
  cached locally, npx skips the install-confirmation entirely and the
  redirect runs uncorrupted. The bug surfaces on fresh machines, CI
  containers, after `npm cache clean`, or when the version pin changed.
- **You're using `pnpm dlx` / `yarn dlx` / `bunx` instead of `npx`.**
  Those have their own prompt behaviors and version conventions;
  spot-check the same `> file` redirect on yours separately before
  assuming the fix carries over.
- **The output file is supposed to be prose, not code.** A redirect of
  e.g. `<tool> --help > docs/cli.md` would legitimately contain
  non-code text. The sanity-check pattern above assumes code-shaped
  output; adapt the first-line predicate to your expected format.

---

**Related:** `lsn_supabase_gen_types_stderr` covers the parallel failure
mode where stderr is piped into the output via `2>&1`. Both entries
describe the same end-symptom (TypeScript-parse-error from a
prompt-text first line) but distinct root causes — npx-install
vs. shell-redirection.
