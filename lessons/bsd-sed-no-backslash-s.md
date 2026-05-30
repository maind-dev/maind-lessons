---
id: lsn_bsd_sed_no_backslash_s
title: BSD sed silently passes-through `\s` regex — pre-commit hooks pass on Linux CI, fail on macOS dev shells
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [bash, shell]
  platforms: []
  tags: [sed, regex, portability, macos, bsd, pre-commit, shell-scripting]
summary: macOS BSD `sed -E` does NOT expand `\s` to a whitespace class — it interprets the pattern as a literal `s*` instead. The substitution silently doesn't match, the line passes through unchanged, and the comparison logic that follows fires false-positives. Use POSIX `[[:space:]]` for cross-platform whitespace matching.
last_validated_at: "2026-05-28"
---

# BSD sed silently passes-through `\s` regex

## Symptom

A pre-commit hook (or any shell script) that extracts a version field
or whitespace-trimmed value with `sed -E 's/.*"version":\s*"([^"]+)".*/\1/'`
works correctly in Linux CI (GitHub Actions, Docker), but on macOS
developer shells the substitution silently fails. The variable ends up
holding the entire unsubstituted line. Comparisons against the expected
extracted value then false-positive.

Concrete example we hit on macOS — pre-commit hook fired
`mcp-bridge Version-Mismatch zwischen package.json und version.ts`
even though both files contained identical `0.2.0`:

```
package.json:     "version": "0.2.0",
src/version.ts: 0.2.0
```

The first value still has the surrounding JSON literal because the sed
substitution never matched.

## Root cause

`\s` is a GNU regex extension. POSIX BRE/ERE does not include `\s`.
BSD sed (which ships with macOS) interprets `\s` in ERE mode as a
backslash-escaped literal `s` — i.e., a single `s` character with
zero-or-more quantifier becomes `s*`. The regex still parses
(no error), it just matches something entirely different.

GNU sed (Linux default, also `gsed` on macOS via brew) treats `\s`
as `[[:space:]]` and the substitution works as the author expected.

```bash
# On macOS (BSD sed):
echo '  "version": "0.2.0",' | sed -E 's/.*"version":\s*"([^"]+)".*/\1/'
#   "version": "0.2.0",        ← line unchanged, no match

# On Linux (GNU sed):
echo '  "version": "0.2.0",' | sed -E 's/.*"version":\s*"([^"]+)".*/\1/'
# 0.2.0                        ← matched correctly
```

## Fix

Use POSIX character class `[[:space:]]` which both BSD and GNU sed
honor identically:

```bash
echo '  "version": "0.2.0",' | sed -E 's/.*"version":[[:space:]]*"([^"]+)".*/\1/'
# 0.2.0     ✓ macOS BSD sed
# 0.2.0     ✓ Linux GNU sed
```

Reproduce on both platforms after fix — both should print `0.2.0`. The
pre-commit hook that previously false-positived on macOS should now
pass with the same input that was already passing on Linux CI.

Or, if you know the input has exactly one space (e.g., JSON output from
a deterministic formatter), match a literal space: `sed -E 's/.*"version": *"([^"]+)".*/\1/'` (`' *'` = zero-or-more literal spaces).

## Where this also matters — and how to find it

The bug is specific to **BSD sed**, but the broader rule "do not assume
GNU regex extensions in cross-platform shell scripts" applies to
related tools with subtly different behavior:

| Tool | `\s` on macOS BSD | Note |
|---|---|---|
| `sed -E` | does NOT expand | the trap this convention covers |
| `grep -E` | expands (empirically) | inconsistent across BSD grep versions |
| `awk` | depends on `--posix` mode | mawk vs gawk vs BSD awk all differ |
| `find -E -regex` | does NOT expand | use POSIX classes |

The safest cross-platform rule: prefer POSIX classes (`[[:space:]]`,
`[[:alnum:]]`, `[[:digit:]]`) over GNU shorthand (`\s`, `\w`, `\d`)
in every shell script that might run on both Linux CI and macOS dev.
Audit an existing repo with:

```bash
grep -rn 'sed.*-E.*\\s' .githooks scripts/ 2>/dev/null
grep -rn 'sed.*-E.*\\w' .githooks scripts/ 2>/dev/null
grep -rn 'sed.*-E.*\\d' .githooks scripts/ 2>/dev/null
```

Each hit is a likely portability bug.

## When this does NOT apply

- **Linux-only environments**: GitHub Actions runners, Linux Docker
  images, server scripts that never touch macOS — `\s` works fine
  because GNU sed is the only sed in scope.
- **`gnu-sed` brew-installed and aliased**: if your `.zshrc` has
  `alias sed=gsed`, your interactive shell sees GNU sed. The trap
  still fires in pre-commit hooks and CI tasks that invoke `sed`
  directly (no alias expansion in scripts).
- **Pure-string contexts where the value is single-token**: if your
  input is `version=0.2.0` (no whitespace between `=` and value),
  the simpler `sed -E 's/.*=(.+)/\1/'` works without needing any
  whitespace class.

When you're certain only one of the two seds is in scope, `\s` is
acceptable. The defense is for cross-platform scripts (pre-commit
hooks, dev-tool installers, repo-level lint passes).

## Related patterns + discovery

This is one instance of a broader "silent failure on cross-platform
shell" class. Cross-references:

- [[lsn_npx_tsc_cwd_fallback]] — `npx tsc` from wrong CWD silently
  falls back to TeX-tsc and reports 0 errors (silent passthrough on
  wrong resolution).
- [[lsn_supabase_secrets_set_project_ref_required]] — `supabase
  secrets set` without `--project-ref` is a silent no-op.

The common thread: tools that don't error on misconfiguration but
silently behave differently than the author intended. Defense is
explicit-form (POSIX class, `--project-ref`, explicit cwd).

When a cross-platform shell script suddenly behaves differently on
macOS vs Linux, ask:

```
search_lessons({
  query: "sed regex whitespace cross-platform macOS",
  tags: ["sed", "portability"],
  limit: 5
})
```

The query hits this convention via the tag match. Cheap to call before
deep-debugging a hook or script that "works on the CI machine but
not locally."
