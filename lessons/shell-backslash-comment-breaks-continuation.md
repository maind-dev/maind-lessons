---
id: lsn_shell_backslash_comment_breaks_continuation
title: "Diagnose a broken pasted multi-line shell command — a trailing comment after a backslash kills line-continuation"
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools: []
  languages: [bash]
  platforms: []
  tags: [shell, bash, zsh, copy-paste, agent-output]
summary: "In a multi-line command joined with trailing backslashes, a backslash is a line-continuation ONLY if it is the very last character on the line. Put a comment or any whitespace after it (cmd --flag \\   # note) and the backslash escapes the space, not the newline. The line ends early, the following lines run as separate commands ('command not found: -f'), and a stray escaped space becomes an argument ('path \" \" not found'). Strip inline comments from multi-line commands meant to be pasted."
last_validated_at: "2026-06-01"
---

## Symptom

You paste a documented multi-line command and it explodes in confusing ways:

```
ERROR: ... path " " not found
zsh: command not found: -f
zsh: command not found: -t
```

The command is correct in spirit; the structure broke.

## Why

A trailing backslash continues a line **only when it is the last character on that line**. A block like this:

```bash
docker build --platform linux/amd64 \   # target arch
  -f Dockerfile \
  -t img .
```

has `\   # target arch` after the first line. The `\` now escapes the following **space**, not the newline. So:

- Line 1 ends at `--platform linux/amd64` plus a literal escaped space → the build gets an empty path argument (`path " " not found`).
- The comment is ignored, but the continuation is gone.
- Lines 2–3 (`-f Dockerfile`, `-t img .`) are parsed as **separate commands** → `command not found: -f`.

This bites hardest with **agent- or doc-generated command blocks**: annotating each line with a `# why` comment is natural in prose but silently breaks the runnable command.

## Fix

For any multi-line command meant to be pasted or run:

- **No inline comments after `\`.** Keep every `\` as the final character on its line.
- Put explanations on their **own lines before** the block, or after a `#` on a standalone line between commands.
- Better for anything non-trivial: ship it as a **script file** (`bash deploy.sh`) instead of a paste-blob — immune to this entirely.

When you (an agent) emit a runnable block, strip the trailing comments.

## When this does NOT apply

- **Single-line commands** — no continuation, no problem.
- **Comments on their own lines** (`# note` with nothing before it on that line) — fine.
- **Heredocs / quoted multi-line strings** — newlines are literal there, not continuations.

```
search_lessons({ query: "multi-line shell command backslash continuation broken paste", tags: ["shell"] })
```
