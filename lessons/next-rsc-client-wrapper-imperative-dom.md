---
id: lsn_next_rsc_client_wrapper_imperative_dom
title: "Wrap imperative DOM (scroll/focus/measure) in a thin Client Component over server-rendered children"
type: convention
tier: community
summary: "In the Next.js App Router, when otherwise-static server-rendered content needs one imperative DOM effect (auto-scroll-to-end, autofocus, measure), do NOT convert the whole subtree to a Client Component. Make a thin \"use client\" wrapper that takes `children` and runs the effect via a ref, and pass the server-rendered subtree in as `children`. Keeps the bundle small and avoids hydration drift from non-deterministic server values."
context:
  tools: []
  languages: ["typescript"]
  platforms: ["nextjs"]
  tags: ["react-server-components", "app-router", "hydration", "client-components", "dom"]
---

App Router gives you Server Components by default. The reflex when you need a tiny bit of imperative DOM — scroll a long horizontal timeline to "today" on load, autofocus an input, measure a node — is to put `"use client"` on the component that renders the content. That pulls the entire subtree (and its data) into the client bundle. You don't need to.

## The pattern: thin client wrapper, server-rendered children

The client boundary should wrap only the *behavior*, not the *content*. The content stays a Server Component and is passed through as `children`:

```tsx
// ScrollToEnd.tsx
"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function ScrollToEnd({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;   // start scrolled to the newest column
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}
```

```tsx
// CalendarHeatmap.tsx — stays a Server Component (no "use client")
export function CalendarHeatmap({ data }: Props) {
  const grid = buildGrid(data, new Date());   // runs on the server only
  return (
    <ScrollToEnd className="overflow-x-auto">
      {grid.weeks.map(/* ... server-rendered cells ... */)}
    </ScrollToEnd>
  );
}
```

## Why this beats making the subtree a client component

1. **Bundle and data stay server-side.** Only the ~10-line wrapper ships to the client; the grid markup and the data that produced it do not.
2. **No hydration mismatch from non-deterministic values.** `buildGrid(..., new Date())` runs once on the server. Because the grid is passed as already-rendered `children`, the client wrapper never re-executes it — so the server and client renders cannot disagree. Put `new Date()` / `Math.random()` inside a client component and you get the classic "text content did not match" hydration error.

## This is NOT the `dynamic({ ssr: false })` case

A plain `"use client"` leaf with `useEffect`/`useRef` is server-rendered then hydrated — fully SSR-safe. Reach for `next/dynamic({ ssr: false })` only for genuinely browser-only libraries (see [[lsn_next_dynamic_ssr_false_client_only]]); it is the wrong and heavier tool for "I just need to set scrollLeft on mount".

## When this does NOT apply

- The subtree needs interactivity/state *throughout* (controlled inputs, per-item handlers) — then it is genuinely a Client Component and the wrapper trick buys nothing.
- The effect needs the *data*, not just the DOM node — then pass the data as props to the client component, not only `children`.

## Related

- [[lsn_next_dynamic_ssr_false_client_only]] — the adjacent trap; this convention is the "don't over-reach for it" counterpart.
- [[lsn_react_hooks_before_early_return]] — hook-order rules still apply inside the wrapper.

Discover neighbours: `search_lessons({ query: "next app router client component hydration", tools: ["nextjs"] })`.
