---
id: lsn_obsidian_vault_top_level_for_ai_agents
title: Obsidian vault top-level layout for AI coding agents — 4 core folders plus optional extensions
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
    - obsidian
    - vault-setup
    - knowledge-management
    - ai-readiness
summary: >-
  Long-running projects benefit from a stable, predictable vault layout
  that an agent can navigate without exploration. Start with 4 core
  folders (Architecture / Code / Sessions / Templates) plus a top-level
  `Welcome.md` entry point. Add three optional extensions (Handoffs /
  Backlog / Archive) only when their content earns the folder. Without
  this discipline, agents waste context on path discovery and humans
  can't promote patterns reliably between scopes.
last_validated_at: "2026-05-20"
upvotes: 0
---

## Why a stable top-level layout matters more for AI agents than for humans

Humans build a mental map of a project over months — finding
`Sessions/2026-04-24_x.md` becomes muscle memory. AI agents have no
such persistence. Every session starts at zero, and discoverability
hinges entirely on:

1. **Conventional folder names** the agent can predict before listing
2. **A single entry point** (`Welcome.md`) that maps the conventions
3. **Audience-separated genres** so the agent loads only what's needed

A vault that mixes genres (one big `docs/` for ADRs, sessions, recipes,
and runbooks) forces the agent to either load everything (context-waste)
or guess (error-prone).

## The 4 core folders (every project)

```
Architecture/   ADRs (decision records) + system overviews
Code/           Code-notes (dataflows, recipes, troubleshooting reconstructions)
Sessions/       Session-notes (retrospectives, one per work-session)
Templates/      Skeleton files for ADR / session-note / code-note
```

One reader audience and one update cadence per folder:

| Folder | Primary reader | Updated when |
|---|---|---|
| `Architecture/` | Someone asking "why was X chosen?" | A decision is revisited or superseded |
| `Code/` | An agent loading context for a specific feature | The underlying code changes |
| `Sessions/` | Someone reconstructing what happened on a given day | Never — snapshots, append-only |
| `Templates/` | Author starting a new ADR / session / code-note | The convention itself changes |

(For the per-feature interaction of these three doc-genres, see the
vetted convention [[lsn_three_tier_doc_per_feature]].)

### Promotion paths between folders

Content moves inward as it proves general:

```
Sessions/<one-off-discovery>  →  Code/<recurring-pattern>  →  Architecture/<irreversible-decision>
        (3+ sessions later)              (architecture-crossing)

Backlog/<idea>  →  Architecture/<ADR>     (when decided)

Handoffs/<active>  →  Archive/<consumed>  (when next session picks it up)
```

ADRs never demote back to sessions. Code-notes never demote to handoffs.
The flow is one-directional. (For the broader 4-layer hierarchy
Workspace → Project → Vault → Memory, see the vetted convention
[[lsn_four_layer_knowledge_hierarchy]] — this convention is the
Vault-internal structure that nests inside its third layer.)

## Extensions (add when needed, not preemptively)

Three further folders to introduce when the project grows past trivial:

```
Handoffs/   Active session-kickoff briefings (prospective; archived when consumed)
Backlog/    Idea-pile / open-thread-tracker (pre-ADR thinking)
Archive/    Time-snapshotted backups of historical state
```

| Extension | Adopt when |
|---|---|
| `Handoffs/` | Context-budget regularly hits 60% → multi-session work pattern |
| `Backlog/` | Open threads accumulate faster than they get ADR-ed |
| `Archive/` | Irreversible refactors start happening and you want recoverable snapshots |

These three are **optional**. A 3-week-old project should not pre-create
them — empty folders read as noise to the agent, who has to inspect each
and find them empty.

## The vault entry point: `Welcome.md`

Every vault gets a top-level `Welcome.md` (or `index.md`) — the agent's
first read when the vault is referenced. Minimal contents:

```markdown
# <Project> Vault

One-sentence project description, link to repo.

## Structure
[folder table from above, customized to actual extensions in use]

## Conventions
- Language: <language used in notes>
- ADRs: numbering scheme + index location (e.g. `Architecture/README.md`)
- Session-notes: pattern + effort-level tracking

## Quick-Index
- [[Architecture/ADR-001-...]] — one-line summary
- [[Sessions/<latest>]] — most recent
- [[Code/<critical-note>]] — feature most often referenced

## Related docs
- Project CLAUDE.md: <path>
- Workspace CLAUDE.md: <path>
```

What `Welcome.md` is NOT for:

- Stack details — those belong in CLAUDE.md (see the vetted convention
  [[lsn_claude_md_structure]])
- Long-form architecture — that lives in `Architecture/`
- Live state like "current sprint focus" — that goes in agent-memory
  (see the vetted convention [[lsn_memory_vs_docs_boundary]])

## When this convention does NOT apply

This vault layout is overhead a small project does not need. Skip it
when:

- **Single-file scope**: a one-page Next.js site, a one-script utility.
  A `README.md` covers everything; a 4-folder vault is theater.
- **Short-lived prototype**: code that will be thrown away in 2 weeks.
  Don't build doc-infrastructure that outlives the code.
- **Existing convention conflict**: the project already uses Diataxis
  (`tutorials/` · `how-to/` · `reference/` · `explanation/`) or
  arc42. Switching mid-project costs more than living with the
  existing structure.
- **Pure library/SDK with reference-docs as primary genre**: the dominant
  doc-type is API reference, not decisions or sessions. A `docs/` folder
  with subsections may serve better than this 4-folder split.

When in doubt before adopting, search for prior vetted conventions on
your stack:

```
search_lessons({
  query: "vault documentation conventions",
  tools: ["claude-code"],
  tags: ["documentation"]
})
```

If a stack-specific convention already exists with a more current
`last_validated_at`, prefer it.

## Anti-patterns and verification

1. **One big `docs/` folder.** Conflates reader audiences. The agent
   loads ADR-reader content when it wanted code-note content. (Same
   anti-pattern viewed per-feature: [[lsn_three_tier_doc_per_feature]].)

2. **Pre-creating empty Handoffs/Backlog/Archive folders.** Reads as
   noise; the agent inspects each, finds them empty, then has to
   re-decide whether the project actually uses them. Add only when
   there is content to put in them.

3. **Mixing English and native-language file names** —
   `Architecture/ADR-001-stack-choice.md` alongside
   `Architecture/ADR-002-Datenfluss-Auth.md` breaks predictability.
   Pick one language and stick to it across the vault.

4. **Putting CLAUDE.md / AGENTS.md INSIDE the vault.** Those belong
   at the repo root (or workspace root). The vault is for human-and-agent
   reference reading; CLAUDE.md is for agent-session bootstrapping.
   They serve different read-cycles. (See [[lsn_claude_md_structure]].)

### Verification snippet

After setting up a vault, an agent should be able to answer "where
would an ADR for the auth system live?" without exploring:

```bash
$ ls <vault>/
Architecture  Code  Sessions  Templates  Welcome.md
# Agent answer: Architecture/ADR-<next-number>-auth-system.md
```

If the answer requires a `find` traversal or `grep`, the layout failed.
A second sanity check: does the agent know which top-level folder a
brand-new code-note about a third-party API quirk goes into, just from
the folder names? If yes → layout works.
