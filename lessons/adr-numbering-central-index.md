---
id: lsn_adr_numbering_central_index
title: Gapless ADR numbering with a central index file — predictable navigation and supersede chains for architecture decisions
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
    - adr
    - architecture
    - naming-conventions
    - knowledge-management
summary: >-
  Architecture Decision Records (ADRs) become valuable only when an
  agent can navigate them without traversal. Pair a gapless filename
  pattern (`ADR-NNN-kebab-title.md`) with a single index file
  (`Architecture/README.md`) that lists every ADR by number, title,
  status, and date. Supersede chains stay visible because the index
  is the source of truth, not the filenames. Without this discipline,
  agents grep blindly and humans rewrite the same decision twice.
last_validated_at: "2026-05-20"
upvotes: 0
---

## Why filename + central index together, not just one

A vetted convention exists on cross-referencing ADRs in their own
context-fields (see [[lsn_adr_cross_references_proactive]]). That
convention handles inter-ADR links. This one handles two upstream
problems that link-discipline can't solve:

1. **Which numbers exist?** Without a gapless scheme, an agent
   composing a new ADR has to `ls Architecture/` and parse numbers.
   With gapless numbering, the next number is `<max>+1` — derivable
   without listing.
2. **Where do I look first?** Without an index file, an agent loading
   ADR context has to `ls` + scan filenames. With an index file at
   `Architecture/README.md`, one `Read` returns the entire ADR map.

The two work together: filenames encode position, the index encodes
state.

## The filename pattern: `ADR-NNN-kebab-title.md`

```
Architecture/
├── README.md                                           # index
├── ADR-001-stack-choice-next-tailwind.md
├── ADR-002-dark-mode-via-next-themes.md
├── ADR-003-monorepo-topology-pnpm.md
├── ...
├── ADR-042-status-page-3d-globe.md
└── ADR-067-mascot-phase2-rarity.md
```

Rules:

- **Three-digit numbers** with leading zeros. Avoids `ADR-1` /
  `ADR-10` / `ADR-100` sort-confusion in shells. Two-digit caps at
  99; pick three for any project you expect past a year.
- **Gapless.** Number `N+1` always exists immediately above number
  `N`. No `ADR-001`, `ADR-003` without a `002`. If an ADR is dropped
  before merge, recycle the number; if dropped after merge,
  `Superseded` it (see status section below) — never delete.
- **Kebab-case-title** after the number. Lowercase, hyphens. Short
  enough to scan in a one-line `ls`, long enough to identify the
  topic without opening.
- **`.md`** extension. No `.markdown`, no `.mdx`. Tools expect `.md`.

The number is the **stable identifier**. The title can be improved by
a follow-up commit; the number must never change.

## The status state-machine

Every ADR has a `Status:` field in its frontmatter or first lines:

```
Proposed → Accepted → (eventually) Deprecated | Superseded by ADR-XXX
```

| Status | When | Index treatment |
|---|---|---|
| `Proposed` | Decision drafted, not yet ratified | Italic in index, marked `(draft)` |
| `Accepted` | Decision in force | Plain entry in index |
| `Deprecated` | Decision no longer in force, no replacement | Strikethrough in index, kept for history |
| `Superseded by ADR-XXX` | Replaced by a newer ADR | Strikethrough + arrow `→ ADR-XXX` |

The state-machine is one-directional. An `Accepted` ADR can become
`Deprecated` or `Superseded`, but cannot return to `Proposed`. If the
decision needs revisiting, write a new ADR that supersedes the old
one — don't rewrite history.

## The index file: `Architecture/README.md`

A single Markdown table is enough. Group by domain only when the ADR
set exceeds ~30 entries; below that, one chronological table is
clearer:

```markdown
# Architecture

ADRs for <project>. See template at [[../Templates/ADR-Template]].

## ADR-Index

| Nr. | Title | Status | Date |
|---|---|---|---|
| [ADR-001](ADR-001-stack-choice-next-tailwind.md) | Stack choice: Next.js + Tailwind v4 + pnpm | Accepted | 2026-04-24 |
| [ADR-002](ADR-002-dark-mode-via-next-themes.md) | Dark mode via `next-themes` (replaces manual FOUC-guard) | Accepted | 2026-04-24 |
| [ADR-003](ADR-003-monorepo-topology-pnpm.md) | Monorepo topology: pnpm workspaces, three subdomains | Accepted | 2026-04-26 |
| [ADR-023](ADR-023-marketing-polish-vercel-deploy.md) | Phase 8 marketing polish + Vercel deploy | Superseded by [ADR-041](ADR-041-multi-region-mcp-rollout.md) | 2026-04-29 |
| ... |
```

When the set passes ~30 ADRs and domain-clustering becomes obvious,
split into sub-tables (`### Marketing-Site`, `### Backend / MCP`,
`### Dashboard`). Numbers stay globally gapless across domains.

## When this does not apply

Skip this convention when:

- **No architectural decisions exist yet.** A 50-line script doesn't
  need ADRs. Adopt when the first irreversible choice happens — the
  ADR-001 is itself the moment the convention begins.
- **The project uses an established ADR tool.** Tools like `adr-tools`
  or `log4brains` enforce their own naming (often `0001-title.md`
  without `ADR-` prefix and with a `.log4brains.yml` index). Don't
  fight the tooling — adapt the table-of-contents principle to whatever
  the tool generates.
- **You're using full RFC-style decision records** (numbered globally
  across the org, not per-project). Then the per-project index becomes
  redundant; the org-wide RFC system handles navigation.
- **The decision count will stay below ~5 forever.** A README with a
  short "Decisions" section in prose is lighter and still readable.

Before adopting, check whether your stack already has a convention:

```
search_lessons({
  query: "ADR architecture decision record naming",
  tags: ["adr", "documentation"]
})
```

## Anti-patterns and verification

1. **Renumbering after deletion.** Once an ADR is referenced (in code
   comments, in another ADR's `Supersedes:` field, in a session-note),
   its number is a public identifier. Renumbering breaks links.
   Always mark old numbers as `Deprecated` or `Superseded by ADR-XXX`,
   never recycle.

2. **No central index ("just `ls` the folder").** Filenames alone
   don't carry status or supersede information. An agent reading
   `ADR-023-marketing-polish.md` without the index doesn't know it
   was superseded by ADR-041. The index is the only place where state
   is normalized.

3. **Mixing index formats over time.** An index that starts as a
   numbered list, becomes a table at ADR-020, then gets a column
   added at ADR-040 breaks scan-ability. Pick a table format on day
   one and migrate the whole index when you change it.

4. **Per-ADR `README.md` instead of a central one.** Each ADR README
   only knows about itself; no cross-cutting view. The central
   `Architecture/README.md` is the only file that sees all ADRs at
   once.

5. **Skipping the `Status:` field on `Proposed` ADRs.** A `Proposed`
   ADR without a status looks identical to an `Accepted` one in the
   index. Always include the status line, even (especially) when it's
   `Proposed`.

### Verification snippet

After applying the convention, both checks should pass without
exploration:

```bash
# Q1: What's the next ADR number?
$ ls Architecture/ADR-*.md | tail -1
ADR-067-some-decision.md
# Agent answer: ADR-068

# Q2: Which ADRs touch authentication, and what's their current status?
$ grep -i auth Architecture/README.md
# Agent reads the index, sees both Accepted and Superseded auth-ADRs
# with links. One Read, no traversal.
```

If either question requires opening individual ADR files to answer,
the convention isn't applied consistently.
