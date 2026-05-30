---
id: lsn_handoff_document_pattern
title: Handoff documents as a separate genre from session-notes — prospective briefings for the next session-self
type: workflow_best_practice
tier: community
lesson_class: general
quality_tier: hand-vetted
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  languages: []
  platforms: []
  tags:
    - documentation
    - session-handoff
    - multi-session
    - context-management
    - knowledge-management
summary: >-
  Long-running coding work spans multiple sessions, often across days.
  Session-notes are retrospective (what happened); handoff documents
  are prospective (what the next session-self needs to know). Treating
  them as one genre — overwriting a session-note to become a kickoff
  brief, or appending kickoff content to retrospectives — breaks the
  read-cycle for the next agent. Keep handoffs in their own folder,
  with 5 mandatory fields, and archive them when consumed.
last_validated_at: "2026-05-20"
upvotes: 0
---

## Why handoffs are a separate genre from session-notes

Both documents look superficially similar — Markdown, dated,
talking about a recent task. But the read-cycle is opposite:

| Document | Direction | Read by | Outlives the writer |
|---|---|---|---|
| Session-note | Retrospective | Future investigator reconstructing what happened | Yes (audit trail) |
| Handoff | Prospective | Next session-self picking up the work | No (consumed) |

The retrospective is **append-only**, frozen the moment it's written
— it becomes part of the audit trail. The prospective is
**ephemeral**, written to be acted on and then archived.

An agent loading a session-note expects a snapshot of the past. An
agent loading a handoff expects a directive for the present. Mixing
them produces ambiguity: is the open thread "Migrate auth middleware"
something that was done, or something to do?

The maind MCP already exposes tooling for this read-cycle:

```
recommend_handoff({approx_tokens: N, turn_count: T, current_focus: "..."})
generate_handoff_brief({focus: "...", recent_decisions: [...], open_threads: [...], next_steps: [...]})
```

Use them. The handoff genre is the file that lands when
`generate_handoff_brief` is saved.

## The handoff document anatomy

Five mandatory fields. Anything else is optional polish:

```markdown
# Handoff — <one-line focus>

**Date:** 2026-05-20
**Previous session:** [[Sessions/2026-05-20_topic]]
**Model used:** claude-opus-4-7 · Effort: high

## Focus

One sentence: what is the next session-self about to work on?

## Recent decisions

- 3-5 bullets, the irreversible-ish choices made in the previous
  session that shape next-session work.
- Each bullet links to the ADR if one was written, else describes
  the decision inline.

## Open threads

- 3-5 bullets, things that are NOT decided yet. Phrased as questions
  or unresolved tensions.
- Avoid mixing "TODO items" (action-ready) with "open threads"
  (decision-pending) — they belong in different bullets.

## Next steps

- [ ] Action 1 — the very first thing to do on session resume.
- [ ] Action 2 — the second thing, only if Action 1 closes cleanly.
- [ ] Action 3 — fallback if Action 1 hits a blocker.

## Verification

How does the next session-self know it's caught up?
- Command to run: `pnpm typecheck` should still pass.
- File to read: the ADR or code-note that locked in the latest
  decision.
- Sanity question to answer: "Why did we choose X over Y?" — if
  the answer requires opening the handoff, the handoff isn't
  doing its job.
```

The verification field is the one most often skipped and the most
useful. Without it, the next agent has no test for "am I oriented?"
and reads the entire handoff repeatedly.

## When to write a handoff (triggers)

Three triggers, any one fires the write:

1. **Context-budget threshold reached.** Most projects set this
   at ~60% of the model's context window (see the vetted convention
   on handoff-thresholds in your project conventions). When the
   threshold fires, write a handoff and start a fresh session.

2. **Multi-day pause expected.** Friday afternoon, end-of-sprint,
   pre-vacation — anywhere the next session-self is "you in a week
   who has forgotten everything." Write a handoff.

3. **Imminent escalation or model-switch.** When a complex sub-task
   needs higher reasoning depth (`/high`, `/xhigh`, `/max`) and
   you're swapping models or sessions, the handoff is the bridge.

Triggers that **do NOT** require a handoff:

- A quick task-switch within the same session.
- A coffee break (no model context loss).
- Finishing a feature cleanly — that's an ADR + session-note +
  optional code-note, not a handoff. (See the vetted convention
  [[lsn_three_tier_doc_per_feature]].)

## The active/archive lifecycle

```
Handoffs/                  ← only ACTIVE handoffs live here
├── HANDOFF-2026-05-20-auth-middleware-cutover.md
└── HANDOFF-2026-05-19-status-page-globe-perf.md

Archive/
└── HANDOFF-2026-05-15-mascot-phase-2.md   ← consumed (kickoff happened)
└── HANDOFF-2026-05-10-stripe-webhooks.md  ← consumed
```

The lifecycle:

1. **Write** — `Handoffs/HANDOFF-YYYY-MM-DD-<topic>.md`
2. **Read** — next session opens with this file as primary context
3. **Consume** — next session acts on the next-steps
4. **Archive** — move to `Archive/HANDOFF-YYYY-MM-DD-<topic>.md`

The `Handoffs/` folder must contain only active items. An agent
listing it should see a small, current set. An overgrown `Handoffs/`
folder with 30 historical entries means the consume-step is being
skipped, and the prospective genre becomes another retrospective.

## When this does not apply

Skip handoffs when:

- **Sessions stay short.** If you reliably finish work in one
  session of under an hour, handoffs are overhead. The session-note
  alone is enough.
- **The work is fully linear and obvious.** "Continue fixing typos
  from the previous session" doesn't need a structured handoff;
  the previous session-note's next-steps section covers it.
- **Tooling already handles it.** If you use `recommend_handoff` +
  `generate_handoff_brief` via the maind MCP, the tools already
  enforce the field structure — you don't need to author the
  template by hand:

```
generate_handoff_brief({
  focus: "Migrate auth middleware to new RLS pattern",
  recent_decisions: ["..."],
  open_threads: ["..."],
  next_steps: ["..."]
})
```

The output is a ready-to-save Markdown document.

- **You work solo and never lose context.** Possible but rare;
  the typical solo developer still benefits from a handoff after
  a 2-day break.

Before adopting, check whether your stack already has a more specific
convention on multi-session continuity:

```
search_lessons({
  query: "handoff session continuity multi-session",
  tags: ["session-handoff", "context-management"]
})
```

## Anti-patterns and verification

1. **Overwriting a session-note to become a handoff.** Destroys
   the audit trail. The retrospective and the prospective serve
   different readers; collapsing them serves neither.

2. **Mixing TODO items with open threads.** TODO items are
   action-ready ("call function X to fix"). Open threads are
   decision-pending ("should we even keep function X?"). Mixing
   them in the same bullet list makes the agent unsure whether
   to act or deliberate.

3. **Never archiving consumed handoffs.** A folder with 30 stale
   handoffs reads as "the project has 30 open threads." The
   next agent doesn't know which is current. Archive on consume,
   keep `Handoffs/` lean.

4. **Handoffs without a verification section.** The next session
   has no way to test "am I oriented?" — reads the handoff
   repeatedly without converging.

5. **Handoffs that just say "continue the work."** That's a
   placeholder, not a handoff. If you can't articulate focus,
   decisions, threads, and steps, you don't need a handoff yet —
   keep working in the same session.

### Verification snippet

After writing a handoff, run this sanity check:

```bash
# Can the next agent answer "what should I do first?" from the
# Next-steps section alone, without reading anything else?
$ head -50 Handoffs/HANDOFF-2026-05-20-*.md
# If the answer to the question above is "yes" — the handoff works.
# If it requires also reading "Recent decisions" or the linked
# session-note, the Next-steps section is too thin.
```

Second check, after the next session consumes the handoff:

```bash
$ ls Handoffs/
# Should NOT contain the file just consumed. If it does, the
# archive step was skipped — fix before more handoffs accumulate.
```
