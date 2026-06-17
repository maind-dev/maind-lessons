---
id: lsn_durable_memory_routing
title: Route durable knowledge by artifact-kind then scope — keep it out of any single client's filesystem
type: workflow_best_practice
tier: community
context:
  tools: [claude-code, cursor, windsurf, copilot]
  languages: []
  platforms: []
  tags: [memory, knowledge-routing, agent-agnostic, conventions]
summary: "When an agent persists durable knowledge, route it on two axes: first the artifact KIND (repo doc, always-on convention, on-demand reference, per-user memory, or bootstrap-local file), then the audience SCOPE (user/team/org/public). Cross-client knowledge then never gets trapped in one client's local filesystem, and the always-on-convention bar stays high enough to avoid init-block bloat."
last_validated_at: "2026-06-17"
---

# Route durable knowledge by artifact-kind then scope

This is the detailed decision tree behind the always-on convention
[[conv_durable_memory_routing]] — the convention carries the principle, this
carries the branches. It is the umbrella over two existing sub-trees:
[[lsn_memory_vs_docs_boundary]] (memory vs. repo-docs) and
[[lsn_self_authored_agent_doc_routing]] (self-authored `CLAUDE.md`/`AGENTS.md`).

## Why two axes, not one

The common mistake is treating "where do I save this?" as a single scope
question (private vs. shared). It is two orthogonal questions:

1. **Kind** — what TYPE of artifact is this? A policy behaves differently from a
   fact, which behaves differently from a reference pattern. Getting the kind
   wrong is worse than getting the scope wrong: a preference mis-filed as an
   always-on convention pollutes every future session's context; a policy
   mis-filed as a recall-only memory never actually changes behaviour.
2. **Scope** — who does it serve? One user, a team, an org, or everyone.

Decide **kind first, then scope**. Scope-first thinking is how knowledge bases
fill up with always-on rules that should have been lightweight memories.

## The two axes

### Axis 1 — Kind

| Kind | Use when | Channel | Cost / bar |
|---|---|---|---|
| Repo doc | Code/architecture tied to THIS repo | ADR / code-note in the repo | low; lives with the code |
| Convention | An always-on behavioural mandate | convention (injected into session-init) | **high bar** — costs context in every matching session |
| Reference | Reusable knowledge / a pattern | a retrieved-on-demand entry | low; loaded only when searched |
| Per-user memory | A personal fact or preference to recall | account-backed memory store (e.g. maind `keep_memory`) | low; surfaces in the user's briefing index |
| Client-local file | Bootstrap/recovery that must survive the KB being down | the client's own memory file | last resort; the only justified local case |

The discriminator between **convention** and **memory** is load-bearing: ask
"is this a *rule the agent must follow every session*, or a *fact the agent
should be able to recall*?" Rules are conventions (high bar). Facts and
preferences are memory. Most "remember I prefer X" items are memory, not
conventions — promoting them to always-on conventions is the most common
init-block-bloat failure.

### Axis 2 — Scope

Once the kind is convention or reference, pick the audience:
**user-private** (this user, all their clients) · **team** · **org** · **public**
(everyone; for conventions this always goes through maintainer review and never
auto-publishes). An account-backed per-user memory is inherently user-scope —
there is no "team memory"; a fact a whole team needs is a team/org reference or
convention, not a personal memory.

## Worked examples

- "I prefer terse PR descriptions." → preference to recall → **per-user memory**
  (not a convention — it is not a mandate to enforce).
- "Never force-push to main." → always-on mandate, serves everyone → **public
  convention**.
- "Our team deploys via staging, never straight to prod." → always-on mandate,
  team-specific → **team/org-private convention**.
- "Postgres STABLE/IMMUTABLE functions reject volatile calls." → reusable
  reference → **public reference entry**.
- "Auth middleware lives in src/proxy.ts and must export default." → repo-specific
  architecture → **repo doc** (code-note), not memory at all.
- "How to reconnect the MCP bridge when it is dead." → bootstrap/recovery →
  **client-local file** (cannot live in the KB it repairs).

## When this does NOT apply

- **Ephemeral / in-conversation facts** that are not needed next session — do not
  route them anywhere; persistence is overhead.
- **Bootstrap/recovery knowledge** stays client-local by design (it cannot depend
  on the knowledge base being reachable) — that row is the intended exception,
  not a violation of the umbrella principle.

When unsure which kind fits, surface this tree before deciding:
`search_lessons({ query: "durable knowledge routing memory convention", tags: ["knowledge-routing"] })`.

## Anti-patterns

- **Scope-first thinking** — deciding "private or shared?" before "policy or
  fact?" yields always-on conventions that should have been memories.
- **Client-local default for durable knowledge** — invisible to the user's other
  agents; the failure the umbrella principle exists to prevent.
- **Bootstrap knowledge in the KB** — unreachable exactly when needed.
- **Silent routing** — always name the destination so a wrong channel is
  correctable by the user.
