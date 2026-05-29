---
id: lsn_effort_level_auto_mode_distinction
title: Don't confuse Effort-Level `auto` (no slash command set) with Auto-Mode (autonomous execution) — they're orthogonal
type: workflow_best_practice
tier: community
lesson_class: general
quality_tier: hand-vetted
context:
  tools:
    - claude-code
  languages: []
  platforms: []
  tags:
    - effort-levels
    - auto-mode
    - session-tracking
    - mode-confusion
summary: >-
  In agent CLIs (Claude Code and similar), "Effort-Level" and
  "Auto-Mode" sound related but are orthogonal axes. Effort-Level
  controls reasoning depth (`/low`, `/medium`, `/high`, `/xhigh`,
  `/max`); Auto-Mode controls whether the agent runs autonomously
  without user check-ins between steps. When tracking effort in
  session-notes, the `Used` field must be the active Effort-Level,
  not the Auto-Mode flag.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The two axes

| Axis | Controls | Values | Set via |
|---|---|---|---|
| **Effort-Level** | Reasoning depth / extended-thinking | `low`, `medium`, `high`, `xhigh`, `max`, `auto` (no slash command set) | `/low`, `/medium`, `/high`, `/xhigh`, `/max` |
| **Auto-Mode** | Whether the agent runs autonomously without user check-ins between steps | on / off | Mode toggle in the CLI |

These can combine freely. `/max` + Auto-Mode = high-reasoning autonomous execution. `/low` + non-auto = quick reasoning with frequent check-ins. No conflict, no implication either way.

## The confusion

When tracking effort retrospectively in session-notes — for example, the convention `Estimated: medium · Used: high · Actual: high` (see related `lsn_effort_level_doc_in_session_notes`) — the `Used` field must be the Effort-Level that was active.

Common mistake: the session ran in Auto-Mode, the writer thinks "auto" is the answer, and the note ends up:

```
Estimated: medium · Used: auto · Actual: high
```

That's wrong. "Used: auto" means "no slash command was set, the model chose its own reasoning depth." If the user explicitly typed `/high` at the start of the session AND Auto-Mode was on, the `Used` field is `high`, not `auto`. Auto-Mode is irrelevant to the Effort-Level axis.

## How to tell which is which

When in doubt about what `Used` should be:

1. **Scroll back to the start of the session.** Look for an explicit `/<level>` slash command in the user's first few messages.
   - Found → that's the `Used` value.
   - Not found → check for extended-thinking artifacts. If thinking blocks appear, the model was running at `medium` or higher.
   - Still not found → `?` (unknown), not `auto`. Default to `?` when you can't confidently identify the level.
2. **Auto-Mode evidence is separate.** Look for absence of "Continue?" prompts, the model executing multi-step plans without check-ins, etc. This goes in a different field (e.g., "Mode: Auto") if you track it at all — never in the Effort-Level field.

## When this does not apply

- **CLIs without slash-commands for effort.** Some agent tools don't expose explicit reasoning-depth controls. There, the Effort-Level axis collapses; only Auto-Mode (or its equivalent) is observable. Skip the field.
- **Session-notes written by automation that captures the slash-command log directly.** If the tool emits `effort_level: high` in metadata on every turn, you don't need the heuristics above. Apply this convention only when reconstructing manually.
- **Single-axis tools where there's no Auto-Mode equivalent.** The conflation can't happen if only one of the two axes exists.

## Verification

Quick self-check on any session-note's `Used` field:

```
Was a /<level> slash command set in this session?
  YES → Used = that level
  NO  → look for thinking artifacts:
        - extended-thinking blocks visible → Used = at-least-medium
        - none visible                     → Used = ? (unknown)
        Never use `auto` unless you specifically observed the model
        was running with no slash command and chose its own depth.
```

`?` is always a better answer than a guessed `auto`. The user reading the retrospective can correct `?` to the real value; a wrong `auto` silently misleads.
