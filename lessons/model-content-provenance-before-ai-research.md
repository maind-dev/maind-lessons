---
id: lsn_model_content_provenance_before_ai_research
title: Model content provenance before mixing human, agent, and AI-research drafts
type: workflow_best_practice
tier: community
context:
  tools: [codex]
  languages: [typescript]
  platforms: [mcp, supabase, nextjs]
  tags: [provenance, ai-research, content-review, admin-ui, security]
summary: Before AI-research drafts enter the same content pipeline as human and agent submissions, add explicit provenance fields and filters. Do not infer origin from status, file path, or submitter role after the fact.
problem: |
  A content graph and admin review surface originally treated content as either published or local drift. The product roadmap added organization content, human-submitted drafts, agent-submitted drafts, and future AI-research drafts. Without an explicit origin model, the UI would eventually need to guess provenance from weak signals such as file path, status, or submitter type.
solution: |
  Add provenance as first-class data before multiple content producers share the same pipeline:

  - Store an explicit origin enum for draft/content rows, for example `human_builder`, `user_agent`, and `ai_research`.
  - Preserve compatibility with old rows by mapping legacy `submitter_type` values to the closest origin.
  - Expose origin in graph nodes, inbox filters, review metadata, and aggregate stats.
  - Keep organization scoping separate from origin. `ai_research` is a source, not an authorization boundary.
  - Require backend-side filtering and authorization for organization-specific views; do not rely on client-side graph filters for access control.

gotchas:
  - "`origin` and `scope` are different dimensions. An organization-private AI-research draft is still organization-scoped and still needs org authorization."
  - "Do not infer AI-generated content from a title prefix or tag. Tags are editorial metadata; origin is audit metadata."
  - "Backfill old rows with a deterministic fallback, but keep the fallback visible in code so future migrations can remove it intentionally."
  - "Client filters improve UX, not security. Org-specific graph routes still need server-side membership/admin checks."
evidence: "Applied while extending a maind MCP content graph and admin inbox for future `ai_research` submissions alongside human builder and user-agent draft origins."
last_validated_at: "2026-05-25"
---

## Data-model shape

Use a narrow union in application code and a constrained enum/check in storage:

```ts
type ContentGraphOrigin =
  | "published"
  | "local_drift"
  | "human_builder"
  | "user_agent"
  | "ai_research";

function originForDraft(row: DraftRow): ContentGraphOrigin {
  if (
    row.submission_origin === "human_builder" ||
    row.submission_origin === "user_agent" ||
    row.submission_origin === "ai_research"
  ) {
    return row.submission_origin;
  }
  return row.submitter_type === "agent" ? "user_agent" : "human_builder";
}
```

The fallback is useful for migration safety, but it should not become the permanent source of truth. New writes should set the explicit origin.

## UI pattern

Show origin in at least three places:

1. Filter controls, so reviewers can inspect one source at a time.
2. Detail panels, so users know what kind of content they selected.
3. Stats, so unexpected volume changes are visible.

For graphs, keep source filtering separate from content-class filtering. A reviewer should be able to ask both "show me only AI-research drafts" and "show me only templates" without those dimensions fighting each other.

## Security boundary

Provenance is descriptive. Authorization still comes from scope and actor permissions:

- Admin global graph: admin-only.
- Organization graph for admins: admin-only with selected org ID.
- Organization graph for members: server derives org ID from membership, not from a client-provided parameter.

## Verification

1. Create or seed one row for each origin and confirm the UI shows all origin counts.
2. Confirm old rows without explicit origin still map deterministically.
3. Confirm organization members cannot switch to another org by changing a URL parameter.
4. Confirm admin-selected organization graphs use server-side admin checks before loading content.

## When this does not apply

If a product has exactly one content producer and no review/audit UX, a separate provenance field may be unnecessary. Add it when multiple producers, trust levels, or review paths share one content table.