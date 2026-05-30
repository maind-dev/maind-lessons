---
id: lsn_npx_install_prompt_corrupts_redirected_file
title: "Diagnose `Need to install the following packages` in a generated file — `npx <tool> > file` corruption"
type: debugging_lesson
tier: community
summary: "When you redirect the output of `npx <tool>` into a file and the tool isn't installed, `npx` writes its interactive install prompt (`Need to install the following packages: ...`) to stdout. The redirect captures the prompt instead of the expected output, and the file ends up with 2-3 lines of npm-install text. Exit code is 0, no visible error. Pre-install the tool OR pass `--yes` to `npx`."
context:
  tools: []
  languages:
    - bash
  platforms: []
  tags:
    - npm
    - npx
    - shell-redirect
    - silent-failure
    - tooling
    - code-generation
---

## Symptom

A `npx <tool> > output.file` invocation appears to succeed (exit 0), but the file contains only:

```
Need to install the following packages:
<tool-name>@<version>
Ok to proceed? (y)
```

instead of the expected output. Downstream consumers (TypeScript compiler, linter, build step) then fail with parse errors on line 1.

## Why it happens

`npx` detects the requested binary isn't on PATH and prompts for install confirmation. That prompt is written to **stdout**, not stderr. When stdout is redirected to a file:

1. The prompt text lands in the file (corrupting it).
2. `npx` waits for stdin input that never arrives (non-TTY) or that the user gives blindly.
3. Either way: the real tool may never run, and any output it would have produced appends after the prompt text — still unparseable.

The shell-redirect target ends up as the prompt transcript, not the generated artifact. The pattern is not supabase-specific — `npx prisma generate > schema.prisma`, `npx openapi-typescript spec.yaml > types.ts`, and any other `npx <not-installed-tool> > file` invocation hit the same trap.

## Detection

After any `npx <tool> > file` invocation, verify volume and content shape — never trust exit-0 or empty stderr:

```bash
wc -l "$file"
# For a generated types file, schema dump, or other large artifact: expect hundreds-to-thousands of lines.
# 2-3 lines = corrupt.

head -3 "$file"
# Should be the first lines of expected content (e.g. `export type Database = ...`).
# "Need to install" = corrupt.
```

For specific generators, grep for a marker that MUST be present:

```bash
grep -c "^export type" database.types.ts
# 0 = corrupt, even if file exists and has some bytes.
```

## Fixes

**Best — pre-install the tool, skip npx:**

```bash
npm install -g supabase
supabase gen types typescript --linked > database.types.ts
# npx no longer involved; no prompt risk.
```

**Acceptable — pass `--yes` to npx:**

```bash
npx --yes supabase gen types typescript --linked > database.types.ts
# Bypasses the install confirmation. Still triggers a silent install on every run if the tool isn't cached.
```

**Anti-pattern — bare `npx` with redirect:**

```bash
npx supabase gen types ... > database.types.ts
# Works ONLY if the tool is already cached AND stdin is a TTY AND the user confirms.
# Fails silently in scripts, CI, sub-agent shells, and after npm cache clears.
```

## When this does NOT apply

- **No redirect involved.** `npx <tool>` printing to a terminal shows the prompt visibly — the user sees it and presses `y`. The corruption only happens when stdout is captured to a file.
- **Tool is already installed in `node_modules/.bin/` or globally.** `npx` skips the prompt entirely and runs the binary directly. The classic safe pattern.
- **`npx --yes` or `NPM_CONFIG_YES=true` in the environment.** Prompt is skipped by configuration; this trap is mooted.

## Related

- [[lsn_supabase_gen_types_stderr]] — different corruption mode: `2>&1` mixes a stderr banner into an otherwise-valid types file.
- [[lsn_supabase_gen_types_local_loses_cloud_rpcs]] — different cause (out-of-sync local DB), same surface symptom (types file missing expected content).
- [[lsn_npx_tsc_cwd_fallback]] — adjacent npx pitfall: `npx tsc` from the wrong CWD resolves to TeX-tsc and reports "0 errors".
