---
id: lsn_next_server_to_client_function_prop_crash
title: "Fix \"Functions cannot be passed directly to Client Components\" — a function/icon prop crosses the RSC boundary"
type: debugging_lesson
tier: community
lesson_class: architecture
summary: "In the Next.js App Router a Server Component cannot pass a function — including a component such as a lucide-react icon — as a prop to a Client Component. Dev and typecheck pass; only the production build fails, at static prerender, with 'Functions cannot be passed directly to Client Components'. Render the icon in a Server Component and pass JSX children, or import the icon inside the Client Component."
context:
  languages: [typescript]
  platforms: [nextjs]
  tools: [claude-code]
  tags: [nextjs, app-router, server-components, client-components, rsc-serialization]
last_validated_at: "2026-06-03"
---

## How it surfaces

Refactoring a leaf component to add interactivity (hover, state) turns it into a Client Component (`"use client"`). If a Server Component still renders it and passes a function-valued prop, the boundary breaks:

```tsx
// section.tsx — a Server Component
import { Search } from "lucide-react";
<CapabilityCard icon={Search} title="…" />  // icon is a function/component
```

`pnpm typecheck` and `pnpm dev` both pass. Only `next build` fails, during static prerender of the route that mounts it:

```
Error: Functions cannot be passed directly to Client Components unless you
explicitly expose it by marking it with "use server". …
{$$typeof: ..., render: function, displayName: ...}
```

The `render: function` in the dump is the tell — a forwardRef/icon component being serialized across the server→client boundary.

## Why

Props that cross from a Server Component into a Client Component become part of the RSC payload and must be serializable. Functions — including React components such as lucide icons (forwardRef objects) — are not serializable. JSX *elements* are.

## Fix — two options

1. Keep the icon in a Server Component and pass pre-rendered JSX as children. The Client wrapper only adds the interaction:

```tsx
<CardShell>{<Search size={20} />}</CardShell>   // a JSX element is serializable
```

2. Or move the icon imports and the component that renders them inside the Client Component, so the function never crosses the boundary.

## Catch it before deploy

Only the production build trips it, so run it locally before pushing:

```bash
pnpm build   # fails at "Generating static pages" when a function prop crosses the boundary
```

## When this does NOT apply

- Passing the icon as a prop is fine when BOTH components are Server Components, or both are Client Components — the boundary is the issue, not the prop type.
- Passing JSX *elements*, plain objects, strings, and numbers across the boundary is allowed; only functions (and class instances) are rejected.

Related: a different facet of the same boundary is [[lsn_next_dynamic_ssr_false_client_only]].
