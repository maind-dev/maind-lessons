---
id: lsn_enum_extension_exhaustive_exclude_guard
title: "Guard subset-only enum consumers with a switch exhaustive over Exclude<Union, …>"
type: debugging_lesson
tier: community
summary: "Adding a value to a shared union/enum compiles everywhere, but a consumer that only handles a SUBSET (e.g. enum members that have a backing resource) throws for the new member at runtime — the type system never forced you to classify it. Model the supported subset as a derived type (Exclude<Union, Excluded>) and make the consumer's switch exhaustive over THAT type, so adding an unclassified member fails tsc instead of crashing at runtime."
context:
  tools: []
  languages: ["typescript"]
  platforms: []
  tags: ["typescript", "discriminated-union", "exhaustiveness", "type-guard", "compile-time-guard"]
---

## Symptom

You add a value to a shared union/enum (a content-class, a provider kind, a
status). Everything compiles. Then a whole feature crashes at runtime — a
function that fans out over the union throws for the new member because it has
no mapping / no backing resource for it. If the throw is masked (e.g. swallowed
into a 404 or empty result), the diagnosis is even slower — see
[[lsn_surface_silent_errors_first]].

## Root cause

The new member is valid *everywhere the full union is accepted*, but some
consumers only support a subset. A `switch (x) { … default: throw }` or a
function that throws for the unsupported case accepts the new member at the type
level and blows up at runtime. Nothing forced you to decide, for each consumer,
whether the new member belongs there.

## Fix — make the subset a type, switch exhaustively over it

Derive the supported subset and narrow into it; the switch then has no `default`
and no throwing case:

```ts
export const EXCLUDED = ["skills"] as const satisfies readonly Kind[];
type Supported = Exclude<Kind, (typeof EXCLUDED)[number]>;

export function isSupported(k: Kind): k is Supported {
  return !(EXCLUDED as readonly Kind[]).includes(k);
}

export function repoFor(k: Kind): Repo {
  if (!isSupported(k)) throw new Error(`${k} has no repo`);
  switch (k) {              // exhaustive over Supported — NO default
    case "lessons":   return REPO_A;
    case "templates": return REPO_B;
    // …every Supported member
  }
}
```

Now add a new union member. If it is "supported", the switch is no longer
exhaustive → `tsc` errors **TS2366 "Function lacks ending return statement"**.
If it is the excluded kind, you must add it to the single-source `EXCLUDED`
list. Either way the compiler forces classification — the runtime trap cannot
recur. Verify the guard fires by temporarily removing a member from `EXCLUDED`
and confirming tsc fails.

## Keep the public signature on the full union

`repoFor(k: Kind)` (not `repoFor(k: Supported)`) — narrow INTERNALLY. Otherwise
every caller that holds a `Kind` must prove `Supported` first, cascading the
change across the codebase. The guard's value is internal exhaustiveness, not a
narrower API.

## When this does NOT apply

Needs `strict` mode (the "lacks ending return statement" check relies on the
declared return type excluding `undefined`). If a consumer genuinely handles
every union member, a plain exhaustive switch with a `never` default already
suffices — the Exclude<> split is specifically for consumers that support only a
subset.
