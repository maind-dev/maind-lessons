---
id: lsn_xyflow_dark_mode_css_vars_not_colormode
title: "Fix React Flow (@xyflow/react) dark mode stuck light until a manual toggle — override --xy-* vars under .dark"
type: debugging_lesson
tier: community
summary: "With class-based dark mode (next-themes etc.), React Flow's <ReactFlow colorMode=...> driven by resolvedTheme is undefined on first render → Controls/MiniMap/Edges render light until the user toggles the theme once. Also its built-in dark palette looks brownish. Fix: override React Flow's --xy-* BASE CSS variables under your app's .dark selector in a stylesheet imported AFTER @xyflow/react/dist/style.css — it applies pre-hydration from frame 1 and lets you match your own surface tokens."
context:
  languages: [typescript, css]
  platforms: [nextjs]
  tags: [react-flow, xyflow, dark-mode, next-themes, css-variables]
---

## Symptom

You use `@xyflow/react` (v12) in a Next.js app with class-based dark mode
(`next-themes`, `.dark` on `<html>`). You wire `colorMode` from the theme:

```tsx
const { resolvedTheme } = useTheme();
<ReactFlow colorMode={resolvedTheme === "dark" ? "dark" : "light"} ... />
```

On first paint the Controls (the +/- toolbar), MiniMap and edges render in
**light** styling and only flip to dark after the user manually toggles the
theme once. The canvas dark default also looks **brownish**, not your app's
neutral dark.

## Why

`colorMode` depends on `resolvedTheme`, which is `undefined` on the first
client render (next-themes resolves after mount) → the prop evaluates to
`"light"` initially, and the chrome stays light until something re-renders
it (the manual toggle). Separately, React Flow's bundled dark palette is its
own warm-grey, not your design tokens.

## Fix: override the --xy-* base variables under your app's `.dark` class

React Flow styles its chrome from CSS variables. Override the BASE vars
(the ones without the `-default` / `-props` suffix) scoped to your app's
`.dark` ancestor — which `next-themes` sets on `<html>` BEFORE hydration, so
it applies from frame 1, independent of the JS `colorMode`:

```css
/* canvas-theme.css — import AFTER "@xyflow/react/dist/style.css" */
.dark .react-flow {
  --xy-background-color: #0a0a0f;
  --xy-background-pattern-color: #27272f;
  --xy-edge-stroke: #71717a;
  --xy-edge-stroke-selected: #a855f7;
  --xy-controls-button-background-color: #16161d;
  --xy-controls-button-background-color-hover: #27272f;
  --xy-controls-button-color: #f4f4f6;
  --xy-controls-button-border-color: #27272f;
  --xy-minimap-background-color: #16161d;
  --xy-minimap-mask-background-color: rgba(10, 10, 15, 0.6);
}
```

Get the exact variable names from `node_modules/@xyflow/react/dist/style.css`
(grep `--xy-`). Override the **base** var, not the `-default` one — higher
specificity (`.dark .react-flow`) wins regardless of the JS colorMode.

Because the visuals are now CSS-driven by the `.dark` class, you can drop the
`colorMode` prop entirely (and the `resolvedTheme` mount-guard with it).
Custom nodes you style yourself just need normal `dark:` utility variants.

## When this does NOT apply

- **System-only dark mode** (no class, pure `prefers-color-scheme`): React
  Flow's `colorMode="system"` already matches; no JS-timing gap.
- **Single-theme apps**: no override needed.
- **Default React Flow node styling**: if you do NOT use custom nodes, also
  set the `--xy-node-*` vars; with custom nodes you style them via your own
  classes instead.

## Related

For the same class-based-dark-mode + first-render timing family, see
[[lsn_next_unstable_cache_no_cookies]] (request-vs-render boundary) only as a
mental-model neighbour. Find this from a symptom:

```
search_lessons({ query: "react flow xyflow dark mode css variables next-themes colorMode", platforms: ["nextjs"] })
```
