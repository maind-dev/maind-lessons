---
id: lsn_claude_code_session_transcript_cwd_recovery
title: "Fix a Claude Code session missing from /resume — the transcript is filed under another directory's project key"
type: debugging_lesson
tier: community
context:
  tools: [claude-code]
  languages: []
  platforms: []
  tags: [claude-code, session-recovery, worktree, resume, cwd, transcript-relocation]
summary: "A session vanishes from /resume because transcripts are filed per directory — ~/.claude/projects/<cwd-slug>/<id>.jsonl — and the picker lists only the current directory's slug. Older clients fix that key at LAUNCH cwd; newer ones relocate the transcript when the session enters a worktree. Same symptom, different mechanism, nothing lost. Recover with Ctrl+W in the picker, or copy the .jsonl together with its sidecar directory."
last_validated_at: "2026-07-14"
---

## The symptom

You worked in one or more Claude Code sessions (CLI or VS Code extension),
stepped away, and on return the session is gone. Either it is simply absent from
`/resume`, or — the worse variant — the entry in the recent list opens an
**empty chat** and then **disappears from the list entirely** once you close it.

It feels like data loss. It is not. The transcript sits on disk under a project
key you are not currently looking at.

## Why it happens: one storage rule, two client behaviours

Claude Code stores every transcript as JSONL at
`~/.claude/projects/<cwd-with-slashes-as-dashes>/<session-uuid>.jsonl` —
`/Users/you/Projects` becomes `-Users-you-Projects`. Both the CLI resume picker
and the VS Code extension's recent list are **scoped to the current directory's
slug**. Git worktrees are the trap, because each worktree
(`/Users/you/Projects-foo`) is its own key.

Which mechanism put the file elsewhere depends on your client version, and the
two models genuinely differ:

- **Filed at launch (older clients).** The key is derived from the cwd at launch
  time and never changes. A session you started while inside a worktree stays
  filed there forever. The confusing part: the transcript's **internal** `cwd`
  field can read the main repo — the session genuinely worked there — while the
  file lives under the worktree key. Storage follows launch-cwd, not where the
  work happened.
- **Relocated on entry (newer clients, documented as of v2.1.198).** Entering a
  worktree — via `EnterWorktree`, `/cd`, or a `/feature`-style workflow skill —
  **moves** the transcript to the worktree's slug. The main repo's list keeps a
  stale pointer, which is why it opens empty and is then evicted.

Long-time users remember worktree sessions staying visible in the main repo's
list; that memory is correct and now obsolete. The workflow did not change, the
storage behaviour did. The detection below does not care which case you are in.

## Detection

```bash
# 1. Every project-key dir for this repo (main + all worktree siblings), newest first
ls -dt ~/.claude/projects/*<repo-name>*

# 2. Find the session by a phrase you remember
grep -rl "<phrase you remember>" ~/.claude/projects/ | grep -v subagents

# 3. Read a candidate's identity: internal cwd, summary, first user message
python3 - "<path>.jsonl" <<'PY'
import sys, json
cwd = summ = first = None
for line in open(sys.argv[1], errors='ignore'):
    line = line.strip()
    if not line: continue
    try: o = json.loads(line)
    except: continue
    if o.get('cwd') and not cwd: cwd = o['cwd']
    if o.get('type') == 'summary' and not summ: summ = o.get('summary')
    if o.get('type') == 'user' and first is None:
        c = (o.get('message') or {}).get('content')
        if isinstance(c, str): first = c
        elif isinstance(c, list):
            for p in c:
                if isinstance(p, dict) and p.get('type') == 'text': first = p['text']; break
print('cwd  :', cwd)
print('summ :', summ)
print('first:', (first or '')[:200])
PY
```

A JSONL with non-trivial size means the session is fully recoverable. Any code it
wrote lives in the worktree's git tree regardless — worst case a fresh session
continues from those files.

## Recovery: the built-in route first

Nothing needs to be moved in the common case:

- **Widen the picker.** Open `claude --resume` in the main repo and press
  **Ctrl+W** — the CONTROL key, not Cmd (on macOS, Cmd+W closes the window). It
  widens the list to all worktrees of the repository; **Ctrl+A** widens to every
  project on the machine. CLI picker only, not the extension's list UI.
- **Resume directly:** `cd <worktree-dir> && claude --resume <session-uuid>`.
- **VS Code extension:** its list is directory-scoped, so open the worktree as
  its own window (`code <worktree-dir>`). This also matches where the session's
  files and CLAUDE.md context live.

**File-level recovery** is for the cases the picker cannot reach — the worktree
was removed, or you want the session visible from a different cwd permanently.
Copy, never move, and bring the sidecar directory:

```bash
SRC=~/.claude/projects/-Users-you-Projects-foo
DST=~/.claude/projects/-Users-you-Projects
ID=<session-uuid>

[ -e "$DST/$ID.jsonl" ] && { echo "exists, skip"; exit 1; }   # never clobber

cp -p  "$SRC/$ID.jsonl" "$DST/$ID.jsonl"            # -p: keep mtime → correct recency order
[ -d "$SRC/$ID" ] && cp -Rp "$SRC/$ID" "$DST/$ID"   # the sidecar dir

cmp -s "$SRC/$ID.jsonl" "$DST/$ID.jsonl" && echo IDENTICAL || echo MISMATCH
```

**The sidecar directory is not optional.** Each `<uuid>.jsonl` has a sibling
`<uuid>/` holding `subagents/agent-*.jsonl` + `agent-*.meta.json` and sometimes
`tool-results/*.txt`. Copy the JSONL alone and the resumed session loses all
subagent and large-tool-result history. `cp` leaves the original intact, so a
botched recovery is non-destructive; `cmp` is authoritative where `du`'s block
rounding lies about size.

Two caveats on the copy: the session resumes with the **target** directory's
context (CLAUDE.md, shell cwd), and on a relocating client it will move away
again the next time it enters a worktree.

## Prevention: announce the relocation via a hook

A small user-global hook makes the filing visible the moment it happens instead
of hours later:

```bash
#!/bin/bash
# ~/.claude/hooks/worktree-session-notice.sh
input=$(cat)
cwd=$(jq -r '.cwd // .new_cwd // empty' <<<"$input" 2>/dev/null)
sid=$(jq -r '.session_id // empty' <<<"$input" 2>/dev/null)
[ -n "$cwd" ] && [ -d "$cwd" ] || exit 0
gd=$(git -C "$cwd" rev-parse --git-dir 2>/dev/null) || exit 0
gcd=$(git -C "$cwd" rev-parse --git-common-dir 2>/dev/null) || exit 0
[ "$gd" = "$gcd" ] && exit 0   # main checkout -> silent
jq -cn --arg cwd "$cwd" --arg sid "$sid" '{
  systemMessage: ("Worktree session: transcript is filed under the slug of " + $cwd + " (invisible in the main repo recent list). Find it via resume picker + Ctrl+W, or: claude --resume " + $sid)
}'
```

Register it for both `SessionStart` and `CwdChanged` in `~/.claude/settings.json`.
The worktree test (`git-dir != git-common-dir`) is robust from any subdirectory
and stays silent in main checkouts and non-git directories.

## When this does not apply

- **Sessions started and kept in the main checkout** are filed there and never
  move — a missing one has another cause.
- **Sessions that legitimately belong to a worktree:** leave them there. Do not
  drag every sibling session into the main key just because you can.
- **A worktree that still exists** and you can `cd` into: relaunch from that
  directory and `/resume` works normally. File copying is only for making a
  session visible from a *different* cwd.
- **A 0-byte or missing JSONL** is a different failure (crash mid-write, disk
  full) — this recipe does not apply; check backups.
- **`--no-session-persistence`** writes no transcript at all, by design.
- **Other agent clients:** the `~/.claude/projects/` layout is Claude Code
  specific; others store history elsewhere.

Before assuming session loss in any multi-worktree setup, check the current
storage behaviour for your client version — and pull the git-state sibling
[[lsn_solo_dev_parallel_agent_state_drift]] at the same time, which covers
treating your own parallel sessions as collaborators:

```js
search_lessons({ query: "claude code session resume worktree cwd recovery transcript relocation", tools: ["claude-code"] })
```
