---
id: lsn_force_graph_mutates_link_endpoints
title: "Fix graph link counts that break after the first render — react-force-graph mutates link.source/target"
type: debugging_lesson
tier: community
summary: "react-force-graph (via the underlying force-graph / d3-force) mutates each link object IN PLACE, replacing the string ids in link.source/link.target with references to the actual node objects so the simulation can run. If you pass the same link array you also read elsewhere (counts, filters, adjacency), those reads see node objects after the first render, not ids — so `new Set(ids).has(link.source)` silently fails. Clone nodes and links before handing them to the graph."
context:
  tools: []
  languages: ["typescript", "javascript"]
  platforms: ["web"]
  tags: ["react-force-graph", "d3-force", "graph-visualization", "mutation", "silent-failure"]
---

## Symptom

Client-side numbers derived from graph links are correct on first paint, then go
wrong once the force simulation starts: a "references" count drops to 0, an
orphan count balloons, or a `Set<id>.has(link.source)` membership test that
worked a moment ago now matches nothing.

## Root cause

`react-force-graph` (and the `force-graph` / `d3-force` core underneath) needs
object references — not ids — to run the physics simulation. So on first render
it MUTATES every link in place:

```
before:  { source: "a", target: "b", kind: "ref" }
after:   { source: {id:"a", x,y,…}, target: {id:"b", …}, kind: "ref" }
```

If you handed the library the same array you also read in a `useMemo` (to count
links, build adjacency, or filter), your reads now get node objects where they
expect id strings. The bug is invisible until the simulation kicks in.

## Fix — clone before passing to the graph

Give the library its own copies; keep your originals pristine:

```ts
const canvasData = useMemo(
  () => ({
    nodes: graphData.nodes.map((n) => ({ ...n })),
    links: graphData.links.map((l) => ({ ...l })),
  }),
  [graphData],
);
// <ForceGraph graphData={canvasData} … />  ← library mutates the clones
// graphData.links still has string source/target → safe for your own counts
```

Shallow clones suffice (`{ ...l }`) — the mutation reassigns the `source`/
`target` properties, so a fresh object per link breaks the aliasing.

## Alternative — normalize at read time

If you can't clone (e.g. you only have the post-mutation array), read endpoints
defensively:

```ts
const endId = (e: unknown) =>
  typeof e === "object" && e && "id" in e ? String((e as { id: unknown }).id) : String(e);
```

## When this does NOT apply

If the force-graph is the ONLY consumer of the link objects (you never read
`source`/`target` yourself), the mutation is harmless — skip the clone. It only
bites when the same objects are read outside the graph.
