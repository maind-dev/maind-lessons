---
id: lsn_git_porcelain_path_quoting_z
title: "Fix phantom path segments when parsing git output: use -z, because porcelain and ls-files quote paths with spaces"
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools: []
  languages: [python, bash]
  platforms: []
  tags: [git, cli, parsing, porcelain, ls-files, path-quoting, quotepath]
summary: "git status --porcelain and git ls-files wrap paths that contain spaces or non-ASCII bytes in double-quotes with C-style escapes (core.quotePath). Splitting that output on '/' to get the top-level directory yields a corrupt segment like the literal quote-Obsidian. Pass -z for NUL-separated, unquoted paths and split on the NUL byte."
gotchas:
  - "core.quotePath defaults to true, so a path like 'Obsidian Vault/x' is emitted wrapped in double-quotes with a leading quote char — and core.quotePath=false still leaves control chars quoted."
  - "-z changes the record format: status entries become 'XY <path>' NUL-terminated, and a rename adds its SOURCE as a separate trailing NUL field with NO status prefix — validate the 2-char status code to skip those."
  - "Splitting porcelain lines on whitespace also breaks on paths with spaces; the fixed column offset (line[3:]) is right, but the quoting still corrupts a naive '/' split."
  - "Invisible until a path with a space or non-ASCII char exists — passes every test on clean ASCII paths, then a 'My Folder/' or an Umlaut breaks it in production."
last_validated_at: "2026-06-11"
---
## Symptom

Code that lists git-tracked top-level directories (or counts changes per
directory) by parsing `git ls-files` / `git status --porcelain` and taking the
first path segment produces a **phantom entry** with a leading double-quote —
e.g. a real `Meltemi` plus a bogus `"Meltemi`.

## Root cause

Git quotes paths that contain "unusual" characters — spaces, non-ASCII
(`core.quotePath` defaults to true). A tracked file at
`Meltemi/Obsidian Vault/Code/x.md` is printed as:

```
"Meltemi/Obsidian Vault/Code/x.md"
```

Split that on `/` and take `[0]` and you get `"Meltemi` (with the leading
double-quote). So the directory shows up twice: once from unquoted entries,
once from quoted ones.

## Fix: ask git for NUL-separated, unquoted output with -z

`-z` disables quoting entirely and uses NUL terminators instead of newlines, so
paths come back as raw bytes you can split safely.

```python
import subprocess

# Tracked top-level dirs — clean, no quoting
ls = subprocess.run(["git", "ls-files", "-z"], capture_output=True, text=True)
tops = {e.split("/", 1)[0] for e in ls.stdout.split("\0") if "/" in e}

# Per-directory change counts from porcelain -z
st = subprocess.run(["git", "status", "--porcelain", "-z"],
                    capture_output=True, text=True)
VALID = set(" MADRCU?!")
counts = {}
for field in st.stdout.split("\0"):
    # A status record is "XY <path>"; rename SOURCES arrive as a bare trailing
    # field with no status prefix — skip them via the status-code check.
    if len(field) < 4 or field[2] != " " or field[0] not in VALID or field[1] not in VALID:
        continue
    top = field[3:].split("/", 1)[0] if "/" in field[3:] else None
    if top:
        counts[top] = counts.get(top, 0) + 1
```

## Gotcha: rename records in -z

In `--porcelain -z`, a rename is emitted as the destination entry
(`R  <dest>`) followed by a **separate NUL field** holding the source path with
no status prefix. If you treat every NUL field as an entry, that bare source
path gets mis-parsed. Validating the two status characters against the
porcelain set (` MADRCU?!`, plus a space at index 2) skips the source fields
without having to special-case rename ordering.

## When this does not apply

- You consume whole paths, not path *segments*, and hand them straight back to
  git (`git checkout -- "$path"`) — the quoted line round-trips fine.
- You use a binding (pygit2 / libgit2, go-git, JGit) that returns structured
  paths — no text parsing, no quoting.
- The same `-z` treatment applies to `git diff --name-only -z`,
  `git ls-tree -z`, `git diff --numstat -z`: the rule is "any porcelain or
  plumbing output you split programmatically gets -z".

## Why it hides

Clean ASCII paths with no spaces never trigger quoting, so this passes every
test until someone has a `My Folder/` or a non-ASCII character in a path. Reach
for `-z` by default whenever you parse git output programmatically.