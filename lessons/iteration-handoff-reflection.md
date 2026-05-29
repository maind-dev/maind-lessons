---
id: lsn_iteration_handoff_reflection
title: After each iteration, reflect on context relevance — propose one or many handoff sessions when ballast outweighs fuel
type: workflow_best_practice
tier: curated
summary: At the end of each iteration, reflect on whether accumulated context still fuels the next iteration or has become ballast. Recommend continue, single handoff, or N parallel handoffs — each brief carries an explicit model and effort-level suggestion. Qualitative complement to the quantitative token-threshold trigger.
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: []
  tags:
    - context-management
    - handoff
    - multi-session
    - agent-orchestration
    - effort-level
last_validated_at: "2026-05-21"
---

## When the trigger fires (and when it doesn't)

At the end of each completed iteration AND immediately before starting a
user-proposed or self-planned follow-up iteration. An iteration is a
self-contained sub-task: a feature slice, refactor pass, bug fix, research
block.

This convention is orthogonal to [[conv_handoff_threshold]]'s token-based
trigger. The token trigger fires on quantity (window filling up); this
reflection fires on quality (signal-to-noise drift). Either can recommend
a handoff independently.

**When this does NOT apply:**

- Every individual turn within a single iteration — the reflection at
  every turn becomes ritual noise the user filters out.
- Single-shot Q&A or pure lookup tasks (no iteration cycle to reflect on).
- Sessions explicitly framed as long-running flow work (e.g. interactive
  debugging sessions where the inherited context IS the work).
- The very first iteration of a session — no accumulated context yet to
  assess.

## The 5 curation axes

Borrowed from Anthropic's context-engineering criteria, adapted to the
iteration lifecycle:

| Axis | Question about the current context |
|---|---|
| Relevance | Is what's in the window STILL relevant to the next iteration? |
| Sufficiency | Is something missing that the next iteration would need to load? |
| Isolation | Would sub-tasks run with less distraction if separated? |
| Economy | How much of the context is ballast (exploration outputs, closed sub-discussions, rejected alternatives)? |
| Provenance | Which sources MUST carry over to the next session, which can it reload itself? |

## Decision tree and brief format

```
Next iteration announced or planned
           │
           ▼
   Reflect across the 5 axes
           │
           ├─ Continue: ≥3 axes say "context still fuels the work"
           │            → no handoff recommendation, stay in this session
           │
           ├─ Single-Handoff: 1-2 axes flag ballast,
           │   follow-up is sequentially dependent
           │            → 1 HANDOFF.md with selective state carry-over
           │
           └─ Multi-Handoff: ≥3 axes flag ballast AND
              sub-tasks are independent of each other
                         → N HANDOFF.md, each with its own model/effort
                         → Justification required: why N parallel over N sequential?
```

Mandatory fields per HANDOFF brief:

- `focus` (1 sentence)
- `inherited_context` (what the new session MUST know — minimal)
- `out_of_scope` (what to explicitly NOT carry, to avoid ballast)
- `recommended_model` — e.g. `claude-sonnet-4-6` (mechanical), `claude-opus-4-7` (architecture-critical)
- `recommended_effort_level` — `/medium`, `/high`, `/xhigh`, `/max` with 1-sentence rationale (per [[lsn_effort_level_end_of_turn_warning]])
- `start_prompt` (copy-paste-ready prompt for the new session)
- `parallel_with` (for multi-split: list of parallel brief IDs and sync points, if any)

The fields `recommended_model` and `recommended_effort_level` are not yet
in the `generate_handoff_brief` tool schema. Workaround until they are:
embed them in the `next_steps` strings (e.g. `"Open new session with
/high · claude-sonnet-4-6: refactor migrations 042-047"`).

## Justification requirements and anti-patterns

**Multi-handoff justification (mandatory when N>1).** Accepted:

- Sub-tasks share no files / no schema (genuine independence)
- Different models/effort levels make sense (UI polish at /low vs.
  migration at /max)
- User-requested parallelization
- Context inheritance would be asymmetrically expensive (one session
  needs SQL schema, another needs only UI components)

Not accepted: "it's faster" or "cleaner separation" without concrete risk.

**Anti-patterns:**

- Running the reflection at every turn → noise that the user filters out.
- Producing a brief without model/effort recommendation → half the work.
- Multi-split without justification → unnecessary session fragmentation.
- Full conversation inheritance in `inherited_context` → reproduces
  exactly the ballast problem this convention exists to solve.
- Skipping the reflection in plan-mode "because the plan is compact
  anyway" — plan-mode benefits most from reflection between phases.
- Treating `out_of_scope` as optional — blank lets the next session
  re-inherit ballast through implicit context bleeding.

## Composition with existing maind conventions

- Complements [[conv_handoff_threshold]] (quantitative trigger) — this
  convention covers the qualitative trigger. Either fires independently.
- Parallel to [[lsn_effort_level_end_of_turn_warning]] (effort bump
  reflection) and [[lsn_claude_md_structure]] (static context hygiene).
- Composes with the `recommend_handoff` tool (token check) and the
  `generate_handoff_brief` tool (brief compilation), now used 1..N
  times per reflection instead of just once.
- Cross-refs: [[conv_handoff_threshold]],
  [[lsn_effort_level_end_of_turn_warning]],
  [[lsn_claude_md_structure]], [[lsn_three_tier_doc_per_feature]].

**Sample maind tool calls during reflection:**

```
# Before flagging "axes_flagged: ≥3", verify this isn't already
# documented as a known cycle in the active stack:
search_lessons({
  query: "iteration handoff ballast context curation",
  tools: ["claude-code"],
  limit: 5
})

# When fetching the quantitative-trigger counterpart for cross-
# linking in the user-facing handoff message:
get_lesson({ id: "lsn_iteration_handoff_reflection" })
get_conventions({ id: "conv_handoff_threshold" })
```

## Verification snippet

Three observations the reflection should make explicit at end-of-iteration:

```
end-of-iteration reflection:
  axes_flagged: <count 0..5>
  recommendation: continue | single-handoff | multi-handoff (N=<n>)
  briefs:
    - id: brief-1
      model: claude-sonnet-4-6
      effort: /high
      rationale: "<one sentence>"
    - id: brief-2  # only when multi-handoff
      ...
  multi_split_justification: "<why parallel beats sequential, if N>1>"
```

If the verification block is empty or absent at the end of an iteration,
the reflection didn't actually fire — re-run it before announcing the
next iteration.
