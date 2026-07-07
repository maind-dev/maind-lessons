---
id: lsn_react_compiler_no_reassign_in_render
title: "Fix \"Cannot reassign variable after render completes\" — don't mutate a counter during render (React Compiler)"
type: debugging_lesson
tier: community
lesson_class: general
summary: "The React Compiler (default in React 19 / Next.js 16) turns the old `let i = -1; arr.map(() => { i++ })` running-counter pattern into a hard lint ERROR: 'Cannot reassign variable after render completes'. Mutating a render-closure variable breaks the compiler's idempotency assumptions. Fix by deriving the index from loop positions (e.g. `ci * n + ti`) instead of accumulating with `let … +=`."
context:
  languages: [typescript, javascript]
  platforms: [nextjs]
  tools: [claude-code]
  tags: [react, react-compiler, react-19, lint, render-purity]
last_validated_at: "2026-06-03"
---

## Symptom

ESLint (React Compiler rule) reports an **error** — not a warning — on a pattern that used to be common, incrementing a counter inside nested `.map()` during render:

```tsx
let idx = -1;
clusters.map((c) =>
  c.tags.map((t) => {
    idx += 1;            // Error: Cannot reassign `idx` after render completes
    const off = offset(idx);
    // …
  }),
);
```

## Cause

The React Compiler (default in React 19 / Next.js 16) memoizes render output and forbids mutating variables captured by the render closure — the mutation makes renders non-idempotent and breaks the compiler's assumptions. It is a hard error, so lint/build fails.

## Fix

Derive the index from the loop positions instead of mutating a counter:

```tsx
clusters.map((c, ci) =>
  c.tags.map((t, ti) => {
    const idx = ci * c.tags.length + ti;   // deterministic, no mutation
    // …
  }),
);
```

Any per-iteration running value should be computed from indices (or produced via `flatMap`/`reduce`), not accumulated with `let … +=` in render.

## When this does NOT apply

- Mutating local variables inside an event handler, `useEffect`, or `useMemo` callback is fine — those do not run during render.
- Projects without the React Compiler enabled get only the older rules; this specific error won't fire, but the deterministic-index form is still cleaner.

Related render-purity rule: [[lsn_react_hooks_before_early_return]].
