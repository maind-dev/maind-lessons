---
id: lsn_react_mounted_flag_use_sync_external_store
title: "Fix react-hooks/set-state-in-effect on hydration mounted-flags — use useSyncExternalStore"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [web, nextjs]
  tags: [react, hydration, use-sync-external-store, lint, next-themes]
summary: "The classic mounted-flag (`useEffect(() => setMounted(true), [])`) now trips the react-hooks/set-state-in-effect lint and forces an extra render. `useSyncExternalStore(emptySubscribe, () => true, () => false)` returns false on the server snapshot and true on the client — hydration-safe theme/client-only branching with no effect, no setState, no lint warning."
problem: |
  Components that branch on client-only state (e.g. next-themes'
  `resolvedTheme`) need to render a deterministic server fallback
  first, then switch after hydration. The widespread pattern:

  ```tsx
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const theme = mounted && resolvedTheme === "dark" ? "dark" : "light";
  ```

  Recent eslint-plugin-react-hooks flags `setMounted(true)` as
  `react-hooks/set-state-in-effect` ("calling setState synchronously
  within an effect can trigger cascading renders"). Suppressing the
  rule hides a real cost: the pattern schedules a second render pass
  immediately after mount.
solution: |
  Replace state+effect with a store whose snapshots differ between
  server and client:

  ```tsx
  import { useSyncExternalStore } from "react";

  const emptySubscribe = () => () => {};
  const useMounted = () =>
    useSyncExternalStore(
      emptySubscribe,
      () => true,   // client snapshot — after hydration
      () => false,  // server snapshot — during SSR/hydration render
    );

  // usage
  const mounted = useMounted();
  const deck = DECKS[mounted && resolvedTheme === "dark" ? "dark" : "light"];
  ```

  React flips the value exactly once when the component hydrates —
  same semantics as the mounted-flag, but declarative: no effect,
  no setState, no lint finding.
gotchas:
  - "The subscribe function must be referentially stable (module scope) — an inline arrow re-subscribes every render."
  - "Server snapshot and first client render MUST agree (both false here) — that is what keeps hydration mismatch-free; do not return true from the server snapshot."
  - "This covers the boolean 'am I on the client' case. For values that keep changing (media queries, storage), give useSyncExternalStore a real subscribe that forwards change events."
last_validated_at: "2026-06-12"
---

## Verification

```bash
# lint goes quiet for the converted component
pnpm eslint src/components/MyComponent.tsx
# before: react-hooks/set-state-in-effect warning at the useEffect line
# after:  no findings
```

Behavior check: server-render (or `next build` + first paint) shows
the fallback branch; after hydration the client branch appears —
with React DevTools profiler showing one fewer render pass than the
state+effect version.

## When this does not apply

- Genuinely event-driven client state (resize, scroll position,
  storage): use a real subscribe implementation or the dedicated
  hook you already have — the empty-subscribe trick is only for the
  one-time hydration flip.
- React <18 (no useSyncExternalStore): the state+effect pattern
  remains the fallback there.

## Related

[[lsn_react_hooks_before_early_return]] — same lint family: hook
mechanics that typecheck but violate runtime contracts.