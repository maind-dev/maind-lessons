---
id: lsn_react_force_graph_nodeopacity_global
title: react-force-graph nodeOpacity is a single global prop — dim individual nodes via node color, not opacity
tier: community
type: workflow_best_practice
summary: In react-force-graph (2d/3d), nodeOpacity is a single scalar applied to EVERY node — it is not an accessor function like nodeColor or nodeVal. So you cannot fade or de-emphasise individual nodes through it. Express per-node transparency through nodeColor instead, returning a color lerped toward the background — the default Three.js mesh material ignores alpha-in-color anyway, so dimming toward the background is the robust way to make a node read as "transparent".
context:
  tools: []
  languages:
    - typescript
    - javascript
  platforms: []
  tags:
    - react-force-graph
    - threejs
    - dataviz
    - frontend
    - rendering
---

## The trap

You want some nodes de-emphasised — say, to fade a whole category while keeping it visible. Most react-force-graph props are accessor-friendly: `nodeColor`, `nodeVal`, `nodeLabel` all accept `(node) => …`. So you reach for the same shape:

```ts
<ForceGraph3D nodeOpacity={(node) => (node.muted ? 0.3 : 1)} />   // does nothing useful
```

`nodeOpacity` is **a single scalar**, not an accessor. The library reads it once and applies it to every node's material. Passing a function coerces to a number (or is ignored); either way you get one global opacity — no per-node fade.

## Why

Per-node opacity would require a distinct material per node; react-force-graph shares material settings and exposes `nodeOpacity` as one global value. The per-node hooks it DOES give you are `nodeColor` (and `nodeThreeObject` for full custom geometry) — not opacity.

## The fix — dim via color toward the background

Return a per-node color lerped toward the canvas background. A node pulled most of the way to the background reads as "faded" without needing real alpha:

```ts
function dim(hex: string, keep: number, bg = "#0a0a0f") {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(bg), 1 - keep);   // keep=0.4 → 60% toward bg
  return `#${c.getHexString()}`;
}

<ForceGraph3D
  backgroundColor="#0a0a0f"
  nodeColor={(n) => (n.muted ? dim(baseColor(n), 0.4) : baseColor(n))}
/>
```

This also sidesteps a second gotcha: the default Three.js mesh material does not honour an alpha channel passed via color (`rgba(...)`), so "just return rgba" would not fade it anyway. Lerping toward the background is what actually reads as transparency.

## When this does not apply

If you need genuine see-through transparency (nodes behind showing through), color-dimming is not enough — supply a `nodeThreeObject` with your own `transparent: true` material and per-node `opacity`. For the common case (de-emphasise / highlight contrast), color-dimming is simpler and renders predictably.
