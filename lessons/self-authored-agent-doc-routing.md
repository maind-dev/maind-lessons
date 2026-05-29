---
id: lsn_self_authored_agent_doc_routing
title: Self-authored agent-doc routing — 4-question gate before writing CLAUDE.md / AGENTS.md / MEMORY.md from own initiative
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
    - agent-self-modification
    - routing
    - claude-md
    - memory-vs-docs
summary: >-
  When an agent self-initiates writing a CLAUDE.md / AGENTS.md /
  MEMORY.md / .cursorrules file, it faces a routing choice humans
  handle by intuition: is this public-lesson-worthy, org-internal,
  project-local, or live state? A 4-question gate routes the content
  before the write. Without it, agents inflate CLAUDE.md with state
  belonging in memory, or bury cross-project patterns in
  project-local files.
last_validated_at: "2026-05-20"
upvotes: 0
---

## Why a routing gate matters for self-authored agent-doc files

When a human writes a CLAUDE.md, they implicitly route by intuition:
"this is project-specific" or "this is just for my current sprint."
An agent, asked the same question, often defaults to the file
in front of it — CLAUDE.md gets stuffed with sprint-state, MEMORY.md
gets stuffed with cross-project conventions, and the four-layer
hierarchy (see the vetted convention
[[lsn_four_layer_knowledge_hierarchy]]) collapses.

Two existing vetted conventions already cover **part** of this routing:

- [[lsn_memory_vs_docs_boundary]] — when something is project-knowledge
  vs. memory-state (4-question gate on memory boundary)
- [[lsn_claude_md_structure]] — what belongs in CLAUDE.md at all
  (context-window efficiency)

This convention is the upstream gate: **before** either of those
applies, decide which scope owns the knowledge in the first place.
The 4 questions determine the destination, not the format.

## The 4-question gate

Before writing a self-authored agent-doc edit, the agent walks these
questions in order. First yes wins:

```
Self-authored doc-write candidate: "<the rule or fact about to be written>"

Q1: Would this help any AI-coding-agent workflow,
    across stacks and tools?
    → YES → public maind lesson candidate (submit via maind MCP)

Q2: Would this only help within this org (same internal practices,
    shared stack-mix, private tooling)?
    → YES → org-private maind lesson + local marker

Q3: Is this inherently project-specific (file paths, custom vault
    names, sub-domain layout, personalia)?
    → YES → local file only (CLAUDE.md / AGENTS.md in the repo)

Q4: Will this change within 3 months (current sprint focus,
    transient deployment URL, in-progress decision)?
    → YES → agent memory, not a doc file at all
```

The gate is **walked in order**. A rule that's both generally useful
(Q1 yes) and project-specific (Q3 yes) belongs in the public lesson
with a project-local pointer — Q1 wins because the broader audience
should benefit.

## Routing destinations (the 4 quadrants)

| Destination | Format | Example |
|---|---|---|
| **Public maind lesson** | `lsn_<slug>.md` submitted via maind MCP | "After any file edit, verify the extension is intact" |
| **Org-private maind lesson** | Same format, `tier: org`, body lives in the org's private lesson repo | "Our service-role keys live in 1Password vault X" |
| **Project-local doc** | `CLAUDE.md` / `AGENTS.md` / `.cursorrules` at repo or workspace root | "Tests must pass via `pnpm test:ci` before push" |
| **Agent memory** | The agent's per-session or persistent memory | "Today's deploy is blocked on PR #4127" |

Two scope-axes underneath this routing:

```
                     CROSS-PROJECT                  PROJECT-SPECIFIC
                          │                                │
STABLE                    │                                │
(months+)        Public maind lesson           Project-local CLAUDE.md
                          │                                │
                  ────────┼────────────────────────────────┼─────────
                          │                                │
EPHEMERAL                 │                                │
(weeks-)         Org-private lesson            Agent memory
                          │                                │
```

The vertical axis is **time-to-staleness**. The horizontal is
**audience-breadth**. Each quadrant has one home.

For the inner-most quadrant (agent memory), the upstream gate is
[[lsn_memory_vs_docs_boundary]] — that convention handles the
memory-vs-project-docs decision once Q4 fires.

## Skip triggers (when the gate doesn't fire)

The gate isn't a tax on every CLAUDE.md edit. Skip it for:

- **Typo / spelling / grammar fixes** in existing content.
- **URL updates** when a service moved (still pointing to the same
  semantic resource).
- **Format-only edits** (Markdown lint, table alignment, bullet
  consistency).
- **Reordering sections** without changing meaning.
- **Renames** (`pnpm test` → `pnpm test:ci`) when the underlying
  thing is the same.

These edits don't add new knowledge — they polish existing
knowledge that's already correctly routed. Running the gate on
them adds friction without benefit.

The gate fires when the agent is about to write **new substance**:
a new rule, a new convention, a new pointer. That's when the
routing decision matters.

## When this convention does not apply

Skip the entire convention when:

- **The user explicitly requested the edit.** If the user said
  "add a note about X to CLAUDE.md," the routing decision was
  made by the user, not by the agent's initiative. Just write
  what was asked.
- **You're working in an org without a maind MCP setup.** Q1 and
  Q2 have no destination — degrade gracefully to "local file or
  memory" (Q3 vs Q4 only).
- **The edit is part of a planned migration.** A bulk-restructure
  of CLAUDE.md based on a prior plan-mode discussion is already
  routed; running the gate per-line would re-litigate the plan.
- **The doc-file is a draft scratchpad, not a committed CLAUDE.md.**
  Scratchpads can hold any quadrant temporarily; only the commit-
  destined version needs the gate.

Before adopting in a new project, check whether your org has
project-specific override-conventions:

```
search_lessons({
  query: "agent doc routing CLAUDE.md memory",
  tags: ["agent-self-modification", "documentation"],
  tier: "all"
})
```

## Anti-patterns and verification

1. **Defaulting to "write it into CLAUDE.md"** because that's the
   file open in the editor. CLAUDE.md is loaded into every session
   — it's expensive context (see [[lsn_claude_md_structure]]).
   Sprint-state and ephemera bloat it and degrade reasoning quality.

2. **Defaulting to "save it to memory"** because it's the easiest
   write. Memory persists across sessions but doesn't onboard new
   team members. Project-rules in memory mean a colleague starting
   tomorrow won't see them.

3. **Writing the same rule into all four destinations** "to be
   safe." Single-source-of-truth violation. When the rule changes,
   you update four places (or, more likely, you update one and
   the other three drift).

4. **Q1-positive rules buried in project-local CLAUDE.md.** A
   workflow rule that helps every stack ("After Edit, verify
   extension") trapped in one project's CLAUDE.md doesn't help
   the next project. Promote it to a public lesson.

5. **Q4-positive sprint-state in CLAUDE.md.** "Current focus:
   Phase 7 Stripe webhooks" becomes stale the moment Phase 7
   ships. Sprint-state belongs in memory or a project board,
   not in agent-bootstrapping context.

### Verification snippet

After running the gate and writing to the chosen destination, the
sanity check is "could a fresh agent re-derive the routing?"

```bash
# Q1-yes rule, ended up in CLAUDE.md? — routing mistake.
$ grep -F "the rule string" ~/Projects/<project>/CLAUDE.md
# Expected: no hit. Hit means demoted-from-cross-project.

# Q3-yes rule, surfaced via maind search_lessons? — routing mistake.
# Expected: no hit on broad project-specific rules from one repo.
```

A second self-check, post-write: re-walk the gate on the edit you
just made. If the destination you chose isn't the one the gate
would land on now, the rule was mis-routed — move it before more
edits depend on it.
