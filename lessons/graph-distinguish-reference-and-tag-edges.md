---
id: lsn_graph_distinguish_reference_and_tag_edges
title: Distinguish reference edges from tag-affinity edges in graph UIs
type: workflow_best_practice
tier: community
context:
  tools: [codex]
  languages: [typescript]
  platforms: [nextjs]
  tags: [knowledge-graph, ux, data-visualization, canvas, tags]
summary: In content graphs, direct references and shared-topic/tag links carry different meaning. Draw references as stronger solid edges and topic/tag links as weaker dashed edges, then brighten only connected edges on hover.
problem: |
  A content graph used both direct Markdown references and tag/topic hubs. When all links had similar visual weight, users could not tell whether an edge meant "this content depends on that content" or merely "both touch TypeScript/PostgreSQL". Topic clusters started looking like real dependency structure.
solution: |
  Encode edge semantics directly into the graph styling:

  - Use solid, stronger, more saturated lines for explicit content-to-content references.
  - Use dashed, low-opacity lines for content-to-tag links.
  - Keep topic hub labels visible, but show individual content labels only on hover to reduce clutter.
  - On node hover, brighten connected edges and dim unrelated edges.
  - Use a distinct topic-node treatment, such as a branded gradient, so topics do not look like content nodes.

  This makes the graph readable at rest and more explorable on hover without implying that every shared tag is a dependency.

gotchas:
  - "Tag links are useful for layout clustering, but they are weaker evidence than explicit references. Their styling should say that."
  - "If content labels are always visible, dense graphs become unreadable faster than the node count suggests."
  - "Hovering a node should highlight both incoming and outgoing connected edges; otherwise users cannot follow paths from the node."
  - "Do not rely only on color to distinguish edge kinds. Dash style and opacity carry meaning for more users and more themes."
evidence: "Applied to a maind MCP content graph where dashed topic links were intentionally made subtle white and connected paths were brightened on hover while non-connected paths dimmed."
last_validated_at: "2026-05-25"
---

## Edge styling pattern

A small style function is often clearer than precomputing presentation fields in graph data:

```ts
function colorForLink(link: GraphLink, hoveredNodeId: string | null): string {
  const connected = isLinkConnectedTo(link, hoveredNodeId);
  if (link.kind === "reference") {
    if (connected) return "rgba(168, 85, 247, 0.96)";
    return hoveredNodeId ? "rgba(139, 92, 246, 0.18)" : "rgba(139, 92, 246, 0.55)";
  }
  if (connected) return "rgba(255, 255, 255, 0.62)";
  return hoveredNodeId ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.18)";
}

function widthForLink(link: GraphLink, hoveredNodeId: string | null): number {
  const connected = isLinkConnectedTo(link, hoveredNodeId);
  if (link.kind === "reference") return connected ? 2.4 : 1.3;
  return connected ? 1.4 : 0.8;
}
```

For libraries that replace `link.source` and `link.target` strings with node objects at runtime, make endpoint resolution tolerate both shapes.

```ts
function endpointId(endpoint: unknown): string | null {
  if (endpoint == null) return null;
  if (typeof endpoint === "object" && "id" in endpoint) return String(endpoint.id ?? "");
  return String(endpoint);
}
```

## Verification

1. Hover a content node with reference links and confirm only connected paths brighten.
2. Hover a topic node and confirm tag spokes brighten but remain visually weaker than references.
3. Apply class/tag/source filters and confirm no orphan tag hubs remain.
4. Test light and dark surrounding UI, especially if the graph canvas has a fixed dark background.

## When this does not apply

If every edge in the graph has the same semantic meaning, a single line style is fine. This convention applies when the graph intentionally mixes explicit references with weaker affinity/grouping relationships.