---
id: lsn_agent_command_block_line_continuation
title: "Agent command blocks break when a `\\` line-continuation is followed by a comment or trailing whitespace"
type: workflow_best_practice
tier: community
lesson_class: general
quality_tier: hand-vetted
context:
  tools:
    - claude-code
    - cursor
    - windsurf
    - copilot
  languages:
    - bash
  platforms: []
  tags:
    - agent-workflow
    - shell
    - command-recommendations
    - line-continuation
    - copy-paste-discipline
summary: >-
  An agent emitting a multi-line shell command joined by `\` continuations
  breaks it when any character follows the backslash — usually an inline
  `# comment`, but trailing whitespace too. A `\` continues a line only as
  the last character before the newline; otherwise the command ends early
  and later lines run as separate broken commands (`command not found: -f`).
  The agent habit of annotating flags inline is the trigger. Fix: put nothing
  after a `\` — move notes to their own lines or prose.
last_validated_at: "2026-05-31"
upvotes: 0
---

## The failure mode

An agent recommends this block (annotated, to be helpful) and the user
pastes it:

```bash
docker build --platform linux/amd64 --no-cache \   # amd64 + cache-bust
  -f apps/api/Dockerfile \
  -t "$TAG" .
```

In `sh`/`bash`/`zsh` a backslash continues a line **only when it is the
last character before the newline**. Here the `\` is followed by spaces
and a `# comment`, so the shell:

1. treats `\ ` as an *escaped space* (a literal, harmless space) — NOT a
   continuation,
2. then reads `# amd64 + cache-bust` as a comment to end of line,
3. so the logical command **ends** at `--no-cache` and runs truncated,
4. and the following physical lines run as brand-new commands.

Observed output:

```
ERROR: failed to build: unable to prepare context: path " " not found
zsh: command not found: -f
zsh: command not found: -t
```

`docker build … --no-cache` ran with no build context (→ `path " " not
found`); `-f …` and `-t … .` became standalone commands. A later
`docker push "$TAG"` then fails with `tag does not exist`, and a
`deploy --image "$TAG"` fails with `Could not find image` — a cascade
whose root cause (one inline comment) is three error messages removed.

**Trailing whitespace alone is the same bug.** `cmd --flag \·` (backslash
then a space then newline) also escapes the space, not the newline — the
continuation silently dies even without a comment. This is why a block
that "looks fine" breaks after an editor or chat client trims/adds a
trailing space.

## Why this is the agent's responsibility

A user pasting an agent-recommended block expects it to run as one unit.
Inline flag-annotations are an agent habit — they read well in chat and
feel helpful — but they are the single most common way an agent breaks
its own command block. The user cannot see why it broke: the error points
at `-f` or a missing context, not at the comment three lines up.

This is the same cost-asymmetry as the sibling conventions
([[lsn_agent_recommended_commands_prompt_free]],
[[lsn_shell_output_sentinel_markers]]): the agent knows the structure and
can make the block paste-safe with zero user effort; pushing "figure out
why it fragmented" onto the user inverts that. The cure is not user
education — it is the agent emitting a clean block.

## The discipline

**Never put anything after a `\`.** The backslash must be immediately
followed by the newline. Move every explanation off the continued lines:

- **Annotate in prose, outside the code block** (preferred). Emit the raw
  command; describe the flags in the surrounding text.
- **Comment on their own, non-continued lines** — a `#` line above the
  command is safe because it has no trailing `\`:

  ```bash
  # --platform amd64: Fly machines are amd64
  # --no-cache: bust the stale clone-layer cache
  docker build --platform linux/amd64 --no-cache \
    -f apps/api/Dockerfile \
    -t "$TAG" .
  ```

- **Restructure into variables** when a value really needs an inline note —
  the comment then sits on a complete (non-continued) line:

  ```bash
  PLATFORM=linux/amd64   # Fly machines are amd64
  docker build --platform "$PLATFORM" --no-cache \
    -f apps/api/Dockerfile -t "$TAG" .
  ```

## Self-check before sending the block

Mentally (or literally) scan every line that ends in `\`: is the backslash
the very last character? A one-shot grep flags the violations — any `\`
followed by whitespace and/or a comment before the newline:

```bash
grep -nE '\\[[:space:]]+(#|$)' block.sh   # any hit = a broken continuation
bash -n block.sh                          # syntax-check; catches many fragments
```

For agents: treat "does any continued line have content after the `\`?"
as a fixed post-generation check on every multi-line shell block, the same
way prompt-free-ness and sentinel-markers are checked.

## When this does not apply

- **Single-line commands.** No continuation, nothing to break — an inline
  trailing `# comment` on a one-liner is fine.
- **Comments on their own lines.** A full `# …` line (no `\`) anywhere in
  the block is safe; only the *continued* lines are sensitive.
- **Heredocs and quoted multi-line strings.** Inside `<<'EOF' … EOF` or a
  quoted string, `\` and `#` are literal data, not shell syntax.
- **Languages with different continuation rules.** Makefiles, PowerShell
  (backtick), and YAML have their own line-joining semantics; this is
  specifically POSIX-shell `\`-continuation.

## Cross-references and generalisability

Sibling conventions on agent-recommended command-block hygiene:

- [[lsn_agent_recommended_commands_prompt_free]] — input side: a prompt
  mid-block consumes later paste-buffer lines as auth input.
- [[lsn_shell_output_sentinel_markers]] — output side: wrap output the
  user must copy back in sentinel markers.
- [[lsn_surface_silent_errors_first]] — broader theme: the real cause is
  silent and upstream of the visible error; surface it at the boundary.

Quick discovery of related vetted conventions:

```
search_lessons({
  query: "agent recommended command block paste safe shell",
  tools: ["claude-code"],
  tier: "all"
})
```

Generalisability: this is universal POSIX-shell tokenizing behavior, not
specific to any tool, OS, or shell. It applies to any agent (Claude Code,
Cursor, Windsurf, Copilot, custom orchestrators) emitting a multi-line
shell block for a human to paste or for a script to run.
