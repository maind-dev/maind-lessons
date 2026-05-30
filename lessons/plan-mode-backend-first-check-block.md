---
id: lsn_plan_mode_backend_first_check_block
title: Require a four-question Backend-First check block in every plan-mode output for new features
type: workflow_best_practice
tier: community
lesson_class: general
quality_tier: hand-vetted
context:
  tools:
    - claude-code
    - cursor
  languages: []
  platforms: []
  tags:
    - plan-mode
    - backend-first
    - workflow-discipline
    - architecture-decisions
summary: >-
  The "default to backend" principle is easy to agree with abstractly
  and easy to skip in practice. The fix is structural: every plan-mode
  output for a new feature must include a four-question check block
  (where does the logic run? where do the data live? IP-critical? if
  client, justify) directly in the plan. Missing block = incomplete
  plan, regardless of how good the rest looks. Forces the question
  before the implementation locks in.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The pattern

For any new feature plan, the plan-mode output must include this
literal block, filled in:

```
Backend-First-Check
1. Compute logic runs in: <Postgres RPC | Edge Function | Client | Hybrid> — Reason: ...
2. Sensitive data: <yes | no> — Protected by: <RLS | service_role-only | SECURITY DEFINER>
3. External APIs: <list or "none"> — All via Edge Function: <yes>
4. IP-critical: <yes | no> — If yes, backend layer: ...
```

If the block is missing, the plan is incomplete and gets rejected
back to the agent for revision. If a field is hand-waved
("Compute logic runs in: probably client"), the plan is also
incomplete. The discipline is "block present + every field
substantively answered."

## Why this beats `lsn_backend_first_default` alone

The existing `lsn_backend_first_default` convention is a *principle*:
client code needs justification, not the other way around. Principles
are easy to nod at and skip when the implementation feels obvious.

The four-question block is *mechanical*. The agent can't produce a
plan without filling each field, and a human reviewing the plan can
see at a glance whether the questions were actually answered. That's
the empirical difference: the principle alone produces drift after a
few sessions; the block stays enforced because skipping it produces
a visibly broken plan.

Think of it as the plan-mode equivalent of "every PR template has a
'Test plan' section": cheap structural enforcement of a discipline
that everyone agreed to in principle.

## How to wire it into a project

Add to the project's `CLAUDE.md` or equivalent agent-instruction file:

```markdown
## Plan-mode requirement: Backend-First check block

In any plan-mode output for a new feature, include this block
verbatim, with every field filled:

  Backend-First-Check
  1. Compute logic runs in: <Postgres RPC | Edge Function | Client | Hybrid> — Reason: ...
  2. Sensitive data: <yes | no> — Protected by: <RLS | service_role-only | SECURITY DEFINER>
  3. External APIs: <list or "none"> — All via Edge Function: <yes>
  4. IP-critical: <yes | no> — If yes, backend layer: ...

A plan without this block is incomplete and must be revised before
implementation begins.
```

That's it. The agent will start producing the block in plan-mode
outputs immediately. The fields force the architectural questions
to surface *before* the code lands, where they're cheap to change.

## What "filled substantively" looks like

❌ Hand-waved:
```
1. Compute logic runs in: Client — Reason: easier
2. Sensitive data: no
3. External APIs: none
4. IP-critical: no
```

"Easier" is not a reason. Re-prompt.

✅ Substantive:
```
1. Compute logic runs in: Postgres RPC — Reason: aggregates portfolio
   values across all positions; running in client requires loading
   every position to the browser, which is bandwidth-expensive and
   exposes per-position data even when the user only wants the total
2. Sensitive data: yes — Protected by: RLS on `positions.user_id = auth.uid()`
   + RPC is SECURITY INVOKER so RLS still applies inside the function
3. External APIs: none (Yahoo Finance read is upstream, cached in DB)
4. IP-critical: no
```

Each field cites the actual constraint, not just a label.

## When this does not apply

- **UI-only changes** — pure styling, copy rewording, animation
  tweaks, accessibility passes. The plan-mode check block is for
  features touching data or business logic.
- **Bugfixes within an existing architectural boundary.** Fixing a
  broken RPC doesn't require re-answering "where should the logic
  run" — it's already there. Note any deliberate boundary change
  in the plan but skip the block.
- **Trivial CRUD with no derived state.** A plain `INSERT INTO …
  RETURNING *` doesn't need the full audit. The block is for
  features where the location decision is non-obvious.

## Verification

```bash
# Search plan outputs in your transcript history for the block
grep -l "Backend-First-Check" plans/*.md
```

Any plan-mode output for a new feature without the string should
fail review. After the convention is wired into `CLAUDE.md`, the
hit rate should be close to 100% within a session or two.
