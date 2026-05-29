---
id: lsn_graph_effective_content_not_published_only
title: Model content graphs from effective content, not only published repositories
type: workflow_best_practice
tier: community
context:
  tools: [codex]
  languages: [typescript]
  platforms: [mcp, nextjs]
  tags: [knowledge-graph, content-management, local-drift, admin-ui, markdown]
summary: Admin knowledge graphs should visualize the effective content set users can act on, not only the published repository listing. Merge published content with local drift, dedupe by aliases, and expose source filters so missing nodes are understandable.
problem: |
  A content graph looked suspiciously sparse even though the project had more than 100 Markdown content files. The graph only read published repository content, while many effective MCP lessons still lived in a local build-time snapshot as local drift. Users interpreted the small node count as missing graph logic rather than missing source coverage.
solution: |
  Build graph snapshots from the effective content set for the current scope:

  - Published repository content that is already source-of-truth.
  - Local drift content that exists in the runtime snapshot but is not yet published externally.
  - Organization-specific merged content when the scope is an organization graph.

  Then make source visible in the graph model and UI:

  - Add an `origin` field such as `published`, `local_drift`, `human_builder`, `user_agent`, or `ai_research`.
  - Count origins in graph stats and expose an origin/source filter.
  - Dedupe local drift against published content by normalized aliases, not only by exact filename.
  - Keep topic/tag nodes derived from the filtered content set so filters do not leave irrelevant orphan hubs.

gotchas:
  - "A graph sourced only from published files can be technically correct and still operationally misleading. Users care about content they can act on now."
  - "Dedupe by exact filename misses migrations where IDs or filenames were normalized. Use aliases from IDs, filenames, stems, and titles."
  - "Do not show local drift as if it were published. Make the source explicit in node details, filters, and stats."
  - "When filtering content, recompute visible tag hubs from remaining content nodes; otherwise tags imply content that is no longer visible."
evidence: "Applied to a maind MCP content graph after published-only sourcing showed too few nodes. Adding local-drift lessons from the build-time snapshot made the graph match the effective admin content set."
last_validated_at: "2026-05-25"
---

## Implementation shape

The graph assembler should accept parsed items that already carry origin metadata:

```ts
type ContentGraphOrigin =
  | "published"
  | "local_drift"
  | "human_builder"
  | "user_agent"
  | "ai_research";

interface ContentGraphNode {
  id: string;
  kind: "content" | "tag";
  origin: ContentGraphOrigin;
  tags: string[];
}
```

For global graphs, load published classes first, then local drift. Build a set of normalized published aliases and skip local items whose aliases already exist in the published set.

```ts
const publishedAliases = new Set(
  publishedItems.flatMap((item) => item.aliases.map(normalizeAlias)),
);

const alreadyPublished = localItem.aliases
  .map(normalizeAlias)
  .some((alias) => publishedAliases.has(alias));
```

## Verification

1. Compare the graph's content-node count with published count plus local drift count after dedupe.
2. Toggle `published`, `local_drift`, and `all` source filters and verify counts change predictably.
3. Publish one drift item, refresh the graph, and confirm it moves from local drift to published rather than becoming a duplicate.
4. Confirm tag hubs disappear when no visible filtered content connects to them.

## When this does not apply

If the graph is explicitly a release artifact or historical published-state audit, published-only sourcing is correct. In that case, label it as a published graph and do not mix in local drift.