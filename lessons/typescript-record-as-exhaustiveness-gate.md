---
id: lsn_typescript_record_as_exhaustiveness_gate
title: Use `Record<UnionType, T>` as a compile-time exhaustiveness gate — new union members force a co-edit
type: workflow_best_practice
tier: community
lesson_class: general
quality_tier: hand-vetted
context:
  tools:
    - typescript
  languages:
    - typescript
  platforms: []
  tags:
    - typescript
    - exhaustiveness
    - type-safety
    - compile-time-gate
summary: >-
  When you have a string-literal union type and a lookup table keyed by
  that union, declaring the lookup as `Record<TheUnion, ValueType>`
  turns "I added a new variant and forgot to wire it" from a runtime
  surprise into a compile error. Cheaper than runtime asserts, no
  cognitive load at the call site, scales to dozens of variants.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The pattern

You have a string-literal union and a lookup map keyed by it:

```typescript
type Route = "/home" | "/profile" | "/settings" | "/billing";

const ROUTE_ICONS: Record<Route, IconName> = {
  "/home": "home",
  "/profile": "user",
  "/settings": "cog",
  "/billing": "credit-card",
};
```

If you later add `"/admin"` to `Route` without updating `ROUTE_ICONS`,
TypeScript fails the build with:

```
Property '"/admin"' is missing in type '{ "/home": ...; "/profile": ...; }'
but required in type 'Record<Route, IconName>'.
```

That's the gate. Every new union member is a forced co-edit of every
lookup table keyed by it.

## Why this beats the alternatives

- **`Partial<Record<Route, IconName>>`** — gives up the gate.
  Forgotten entries become `undefined` at runtime.
- **`{ [key: string]: IconName }`** — also gives up the gate. Plus
  any string is now a valid key, including typos.
- **Runtime assert (`if (!ROUTE_ICONS[route]) throw …`)** — catches
  the bug but only after the code path runs. CI passes; production
  crashes on the new route.
- **Manual checklist in the PR description** — relies on humans
  remembering. Fails the moment a refactor passes through.

`Record<Union, T>` puts the check on the compiler, where it can't be
skipped or forgotten.

## How to apply

Whenever you write a lookup whose keys are a known finite set,
**type the keys as a union and declare the map with `Record`**.
Common shapes:

```typescript
// Color / theme palettes
type Theme = "light" | "dark" | "hi-contrast";
const COLORS: Record<Theme, Palette> = { ... };

// Feature flags keyed by feature
type Feature = "billing-v2" | "search-v3" | "ai-assistant";
const FEATURE_OWNERS: Record<Feature, TeamId> = { ... };

// State machines
type Status = "idle" | "loading" | "error" | "success";
const STATUS_MESSAGES: Record<Status, string> = { ... };

// i18n bundles (keyed by language tag)
type Locale = "en" | "de" | "es" | "fr";
const GREETINGS: Record<Locale, string> = { ... };
```

Pair this with `as const` for the union itself, so the union is
derived from the canonical source-of-truth list:

```typescript
export const ROUTES = ["/home", "/profile", "/settings", "/billing"] as const;
export type Route = (typeof ROUTES)[number];

const ROUTE_ICONS: Record<Route, IconName> = { ... };
```

Adding to `ROUTES` now both extends the type AND fails every lookup
table that was complete a minute ago. Single edit, full compile-time
sweep.

## When this does not apply

- **Open key sets.** If the keys come from user input, an external
  API, or any source TypeScript can't enumerate, `Record<Union, T>`
  doesn't fit — use `Map<string, T>` or `Partial<Record<…, T>>` with
  a runtime fallback.
- **Sparse maps where missing-key is meaningful.** Some lookups
  deliberately leave entries undefined (e.g., "only some routes have
  a custom analytics ID"). Use `Partial<Record<Union, T>>` there and
  document the intent in a comment.
- **Performance-critical lookups over very large unions** (>10K
  variants). `Record` is fine, but consider whether the lookup
  shouldn't be data-driven anyway at that scale.

## Verification

The check is the compile output. To confirm the gate is wired, in a
scratch branch add a deliberate new variant to the union and try to
build:

```bash
echo 'export type Route = "/home" | "/admin"' > test-types.ts
pnpm tsc --noEmit
```

The build should fail on every map keyed by `Route`. If it doesn't,
you have a map using `Partial<Record>` or `[key: string]` somewhere —
that's the next thing to tighten.
