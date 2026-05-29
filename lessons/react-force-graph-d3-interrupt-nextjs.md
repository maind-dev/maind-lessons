---
id: lsn_react_force_graph_d3_interrupt_nextjs
title: Fix react-force-graph `i.interrupt is not a function` crashes in Next.js
type: debugging_lesson
tier: community
context:
  tools: [codex]
  languages: [typescript]
  platforms: [nextjs]
  tags: [react, force-graph, d3, turbopack, webpack, canvas]
summary: When `react-force-graph-2d` crashes in D3 zoom code with `i.interrupt is not a function`, suspect duplicate or incompatible D3 package resolution before debugging graph data. Alias `d3-selection` and `d3-transition` consistently for both Turbopack and Webpack.
problem: |
  A Next.js dashboard graph route mounted a `react-force-graph-2d` canvas, but the browser console crashed with:

  `Uncaught TypeError: i.interrupt is not a function`

  The stack pointed into minified D3 zoom/transform chunks. Changing node data, canvas styling, and component boundaries did not solve the crash because the graph data was not the root cause.
solution: |
  Treat this as a dependency-resolution problem first. `react-force-graph-2d` relies on D3 selection/transition behavior; if the bundle resolves incompatible D3 modules, zoom code can call `interrupt()` on an object that does not have the transition-enabled selection methods.

  Fix the dependency boundary in `next.config.ts`:

  ```ts
  const D3_SELECTION_ALIAS = "d3-selection/src/index.js";
  const D3_TRANSITION_ALIAS = "d3-transition/src/index.js";

  const nextConfig = {
    turbopack: {
      resolveAlias: {
        "d3-selection": D3_SELECTION_ALIAS,
        "d3-transition": D3_TRANSITION_ALIAS,
      },
    },
    webpack(config) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "d3-selection": D3_SELECTION_ALIAS,
        "d3-transition": D3_TRANSITION_ALIAS,
      };
      return config;
    },
  };
  ```

  Keep the graph component client-only and import `d3-transition` before mounting the graph component so transition methods are registered before D3 zoom helpers run.

gotchas:
  - "A stack trace inside D3 zoom or a minified force-graph chunk can still be caused by package resolution, not bad graph nodes or links."
  - "Fix only Turbopack or only Webpack if the project uses exactly one; otherwise the error can return in the other build path."
  - "Restart the Next.js dev server after changing aliases. Bundler caches can preserve the broken module graph."
  - "Do not add broad `any` casts around graph data to hide the crash; the failure is at runtime package identity, not TypeScript shape."
evidence: "Observed in a Next.js dashboard using react-force-graph-2d. The crash disappeared after adding d3-selection and d3-transition aliases for both Turbopack and Webpack, plus importing d3-transition in the client graph module."
last_validated_at: "2026-05-25"
---

## Why this happens

D3 packages are small and often pulled transitively. A graph library can receive one copy or entrypoint of `d3-selection` while `d3-transition` patches another. The runtime then has an object that looks close enough to a D3 selection for part of the call chain, but not close enough when zoom/transform calls `interrupt()`.

The minified stack makes this look like a canvas rendering bug. The better first question is: are all D3 selection/transition imports resolving to the same compatible entrypoints?

## Verification

1. Add the aliases to the active Next.js bundler path.
2. Restart the dev server or rebuild the app.
3. Open the graph route and confirm the canvas renders without the console error.
4. Run the app's typecheck and build path so the fix covers more than local dev.

## When this does not apply

If the console error mentions missing `window`, `document`, `ResizeObserver`, or hydration mismatches, first check whether the graph component is loaded only from a Client Component. If the graph renders but physics or labels are wrong, debug graph data and canvas drawing instead. This convention is specifically for D3 `interrupt()` runtime failures during zoom/transform initialization.