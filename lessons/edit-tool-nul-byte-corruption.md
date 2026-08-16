---
id: lsn_edit_tool_nul_byte_corruption
title: "Diagnose NUL bytes in freshly edited source files: git flips to binary, grep goes blind, typecheck stays green"
type: debugging_lesson
tier: community
provenance:
  source: memory
  source_id: fbd97836-51fe-46a7-a55d-64b988d97e5c
  migrated_at: "2026-08-15"
summary: "A file edit can silently land NUL bytes inside string literals (observed with an agent's Edit/Write tooling: every space typed inside a template literal became \\0). Typecheck and tests stay green — NUL in a string literal is valid TypeScript — while runtime semantics are wrong. The two detection signals: git diff suddenly reports the source file as 'Bin N -> M bytes', and grep cannot find code you just wrote. Count NULs per edited file as a post-edit check; repair byte-wise."
context:
  tools: [claude-code, cursor, windsurf]
  languages: [typescript, javascript]
  platforms: []
  tags: [file-corruption, nul-bytes, post-edit-verification, silent-failure, tooling]
---
## The corruption and why nothing catches it

Observed 2026-08-15 (Claude Code Edit/Write on a TypeScript file): every space
character **inside a string or template literal** was written as a NUL byte
(`\0`) — `` `${w.path} ${w.branch}` `` and `.join(" ")` — while spaces outside
literals (indentation, keywords) stayed correct. Three NULs across two files.

Nothing in the normal pipeline objects:

- **`tsc --noEmit` is green** — a NUL inside a string literal is syntactically
  valid TypeScript.
- **Tests stay green** unless one compares the exact literal.
- **Editors render it** as a thin box or nothing at all.

At runtime the semantics are silently wrong — a join/separator becomes `\0`
instead of a space, which in a signature or cache-key function means quiet
misbehavior, not a crash. A cousin of [[lsn_surface_silent_errors_first]]: the
failure produces no signal where you are looking.

## The two detection signals

Both are unspecific-looking, which is why they are worth memorizing as a pair:

1. **`git diff --stat` reports the file as `Bin 20108 -> 20980 bytes`** instead
   of `+/-` line counts. A source file git suddenly treats as binary is the
   loudest available hint.
2. **`grep` cannot find the function you just wrote.** git/grep treat the file
   as binary, so searching for your own fresh code returns nothing — which
   feels like "the edit never landed" although it did.

## Locate, repair, verify

```bash
# count (the post-edit check — one line, catches the whole class)
python3 -c "print(open('file.ts','rb').read().count(b'\x00'))"

# locate with line numbers + context
python3 -c "
d=open('file.ts','rb').read(); o=-1
while (o:=d.find(b'\x00',o+1))!=-1:
    print('line', d[:o].count(b'\n')+1, d[max(0,o-60):o+60].replace(b'\x00',b'<NUL>'))
"

# repair — only after confirming a space was intended at each site
python3 -c "
p='file.ts'; d=open(p,'rb').read(); open(p,'wb').write(d.replace(b'\x00',b' '))
"
```

Verify afterwards that `git diff` shows text hunks again and the NUL count is
zero. In the same incident, string-matching edits on files rich in special
characters (em-dashes, box-drawing) also failed to match — line-precise
scripted patches were the reliable fallback there.

## Post-edit verification is content, not just filename

Checking the file extension after an edit ([[lsn_file_extension_post_edit_check]])
does not cover this class: the name is intact, the content is poisoned. After
writing files that contain string literals, the one-line NUL count is the
cheapest guard against a failure mode that neither typecheck, tests, nor eyes
reliably see.

## When this does NOT apply

- **NULs in binary assets** (images, archives) are normal — the check applies
  to source and text files only.
- **A file that was ALWAYS binary to git** points at `.gitattributes` or real
  binary content, not this corruption.
- **grep finding nothing for code you wrote days ago** is usually a refactor
  or wrong path — the signal here is specifically *fresh* code vanishing.
