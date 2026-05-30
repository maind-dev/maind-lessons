---
id: lsn_shell_output_sentinel_markers
title: Agent-recommended shell commands should embed sentinel markers around output the user must copy back
type: workflow_best_practice
tier: community
lesson_class: general
summary: When an agent recommends a shell command whose output it needs back from the user, the command should wrap the relevant output in echo-based sentinel markers (>>>>> PASTE-START / <<<<< PASTE-END). Without delimiters, the user has to guess which slice of a noisy terminal scrollback to copy — paste-too-much, paste-too-little, and paste-duplicates all happen and slow the diagnosis loop. This is the agent's responsibility, not the user's.
context:
  tools:
    - claude-code
    - cursor
    - windsurf
    - copilot
  languages: []
  platforms: []
  tags:
    - agent-workflow
    - remote-shell
    - ssh
    - copy-paste-discipline
    - terminal-output
    - diagnostic-workflow
last_validated_at: "2026-05-29"
---

## The failure mode

A user runs an agent-recommended diagnostic command in a remote shell (SSH session, container exec, RunPod pod) and is asked to "paste the output back". The terminal scrollback contains:

- The actual relevant output (e.g., a `grep -c` count, a `jq` aggregate, a `git log` summary).
- The prompt before the command.
- Output from a previous unrelated command still on screen.
- Background-loop output that arrived between scrollback snapshots.
- Possibly a partial subsequent command the user already started typing.

Without explicit delimiters, the user has to visually parse all of that and guess the boundary. Common failure modes:

- **Paste-too-much**: the agent receives surrounding noise that confuses the analysis ("is this 295 the count or part of a log line?").
- **Paste-too-little**: a multi-line output gets truncated mid-table because the user grabbed only the visible screen.
- **Paste-duplicates**: re-running the command produces two outputs in scrollback; the user pastes both and the aggregate doubles.
- **Paste-mid-loop**: a background `tail -f` or active `while true` loop writes between the command and the next prompt, so the relevant output is now buried in unrelated lines.

Each round-trip the user has to ask "which part?" or the agent has to ask "can you re-paste, starting from X?" — both burn turns.

## Why this is the agent's responsibility

The agent knows which command output it needs to read. The user does not — they see only an opaque blob of terminal text and have to reverse-engineer the agent's intent. Pushing "find the relevant slice" work onto the user inverts the cost asymmetry: the agent could have written one extra `echo` line and made the slice self-evident.

The same discipline that applies to prompt-free recommended commands (see related conventions below) applies here: the agent's recommendation should minimize what the user has to figure out, not maximize it.

## The pattern

Wrap any command whose output you need back from the user with two visible sentinel `echo` lines:

```bash
echo ""
echo ">>>>>>>>>> PASTE-START >>>>>>>>>>"
your-command-here
echo "<<<<<<<<<< PASTE-END <<<<<<<<<<"
echo ""
```

Properties that make sentinel markers work:

- **Visually distinct from real output**: ASCII chevrons (`>>>>>` / `<<<<<`) or box-drawing chars stand out in monospace terminals where actual command output rarely contains them.
- **Greppable**: if the user wants to extract the slice programmatically later, `sed -n '/PASTE-START/,/PASTE-END/p'` works.
- **Same direction-arrows on both sides**: `>>>>>` to enter, `<<<<<` to leave — visually mirrors a region.
- **Blank lines outside**: separates the marker block from preceding/following terminal noise.
- **Self-documenting label**: `PASTE-START` (not just `===`) tells the user what to do without re-reading the agent's prose.

For multi-command diagnostics, give each its own labeled region so partial pastes are still useful:

```bash
echo ">>>>>>>>>> STAGE-1-COUNT-START >>>>>>>>>>"
grep -c '"component":"scout-debug"' /tmp/dry-run.log
echo "<<<<<<<<<< STAGE-1-COUNT-END <<<<<<<<<<"

echo ">>>>>>>>>> STAGE-2-AGGREGATE-START >>>>>>>>>>"
python3 /tmp/agg.py
echo "<<<<<<<<<< STAGE-2-AGGREGATE-END <<<<<<<<<<"
```

For long outputs (hundreds of lines from a build or test run) where forcing a full paste through chat is wasteful, combine the marker with a tee-to-file pattern:

```bash
your-long-command 2>&1 | tee /tmp/output.txt
echo ""
echo ">>>>>>>>>> SHORT-SUMMARY-START >>>>>>>>>>"
echo "Full output saved at /tmp/output.txt ($(wc -l < /tmp/output.txt) lines)"
tail -20 /tmp/output.txt
echo "<<<<<<<<<< SHORT-SUMMARY-END <<<<<<<<<<"
```

The user pastes the short summary; if the agent needs more, it asks for `sed -n '<line>,<line>p' /tmp/output.txt` of a specific range.

## When this does not apply

- **Single-line, well-known commands**: `git status`, `ls`, `pwd` — the user knows what they look like, output is short, markers add noise without value.
- **Interactive output the user reads themselves**: if the command result is for the user to decide an action (not for the agent to receive back), markers are overhead.
- **CI / automation contexts**: if the script runs unattended and output is parsed by a downstream tool, sentinel echoes just clutter the log. Markers are specifically for human-copy-paste back to an agent.
- **Output that already has a unique signature**: a command returning a single JSON object on a fresh prompt is self-delimiting enough; the marker overhead is unnecessary.

## Detection in retrospective

If a session transcript shows recurring "can you re-paste?" or "I see only part of the output, where does it end?" turns, the agent recommended commands without sentinel markers. The cure is not "user education" — the cure is updating the agent's recommendation template to wrap outputs in echo-markers by default for any command whose output needs to round-trip back.

## Cross-references and generalisability

Quick discovery of related vetted conventions:

```
search_lessons({
  query: "agent shell command output copy paste",
  tools: ["claude-code"],
  tier: "all"
})
```

Related curated conventions:

- [[lsn_agent_recommended_commands_prompt_free]] — sibling convention on the input side: agent-recommended command blocks must be prompt-free so the paste-buffer is not corrupted by interactive auth. This convention is the output-side complement: agent-recommended commands should embed sentinel markers so the user knows what slice of terminal output to copy back.
- [[lsn_surface_silent_errors_first]] — broader theme: make failure modes visible at the boundary rather than relying on downstream debugging. Sentinel markers make "I copied the wrong slice" visible immediately ("Alex, I see PASTE-START but no PASTE-END, can you re-paste?") instead of producing silently-wrong aggregates downstream.

Generalisability: this applies to any agent (Claude Code, Cursor, Windsurf, Copilot, ChatGPT, custom orchestrators) recommending shell commands to any human-in-the-loop terminal context where the user is expected to copy output back. The mechanism is universal to terminal scrollback ergonomics, not specific to any one tool, OS, or shell.
