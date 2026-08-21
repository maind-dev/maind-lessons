---
id: lsn_tailwind_same_property_utilities_order_decides
title: "Fix a layout that ignores its own class string — two Tailwind utilities for one property, and source order decides"
type: debugging_lesson
tier: community
summary: "Putting `relative` and `fixed` (or `md:w-auto` and `md:w-[56px]`) on the same element is not an error and not a merge — Tailwind emits both rules at equal specificity, so whichever it prints LAST wins, regardless of the order you wrote them in. The class string reads like intent; the page follows the stylesheet. Concatenated className expressions hide it, because the two utilities sit in different string literals."
context:
  languages: [typescript, css]
  platforms: [tailwind, web]
  tags: [tailwind, css, specificity, cascade, utility-conflict, layout, guard]
---

## The symptom

A layout ignores what the class string plainly says.

```tsx
// A mobile drawer: out of flow, slid off-screen.
<aside className={
  "group/rail relative z-40 flex h-full shrink-0 " +
  "fixed inset-y-0 left-0 w-[246px] -translate-x-full md:relative"
}>
```

The drawer is invisible, as intended — and still occupies **246 px of layout
width**. On a 390 px phone the content gets 144 px and the page looks folded in
half.

Or, one breakpoint deeper:

```tsx
"… md:relative md:inset-auto md:w-auto …" + (narrow ? "md:w-[56px]" : "md:w-[214px]")
```

The sidebar collapses to zero width and its absolutely-positioned inner panel
floats over the page content.

## Why

Tailwind does not detect conflicts and does not merge them. `relative` and
`fixed` are two ordinary rules with **identical specificity** (a single class
each). When both match, the cascade falls through to source order — the order
they appear in the generated stylesheet, which is Tailwind's own canonical
utility order, **not** the order in your `className`.

For position, Tailwind emits `static, fixed, absolute, relative, sticky`. So
`relative` is printed after `fixed` and wins — even though `fixed` was written
later. Same for `w-auto` vs an arbitrary `w-[56px]`.

Two things make this hard to see:

- **The class string reads like intent.** `"fixed … md:relative"` looks like a
  base value with a breakpoint override, and for `md:` it is — media-query
  variants ARE emitted after base utilities, so those override correctly. The
  failure is only between two utilities at the SAME variant level.
- **Concatenation splits them up.** In a multi-line `className={a + b + c}` the
  two conflicting classes usually live in different string literals, sometimes
  20 lines apart. Nobody reads them as one list, because they are not written as
  one list.

## What does not help

- Reordering the class string. The stylesheet order is fixed.
- Type checking, ESLint's core rules, or the build. All three are happy: the
  value is a valid string.
- `tailwind-merge` — it does solve this, but only where you actually route the
  string through `twMerge()`. Hand-concatenated strings in components that
  predate the helper stay unprotected, which is where the bug lives.

## The fix, and then the guard

The fix per site is to delete the loser:

```tsx
// mobile: out of flow; from `md` up: back in flow for the absolute child
"fixed inset-y-0 left-0 w-[246px] md:relative md:inset-auto " +
(narrow ? "md:w-[56px]" : "md:w-[214px]")
```

The guard matters more, because this recurs. A small source-level test over the
layout components catches it without a browser:

```ts
const PROPERTY: [RegExp, string][] = [
  [/^(static|fixed|absolute|relative|sticky)$/, "position"],
  [/^(block|inline-block|inline|flex|inline-flex|grid|hidden)$/, "display"],
  [/^w-/, "width"], [/^h-/, "height"],
];
const variantOf = (c: string) => (c.includes(":") ? c.slice(0, c.lastIndexOf(":")) : "");
const baseOf    = (c: string) => (c.includes(":") ? c.slice(c.lastIndexOf(":") + 1) : c);
// group by `${variant}|${property}`; more than one distinct class per group = conflict
```

Two details decide whether the guard is usable:

1. **Group by variant, not by property alone.** `w-[246px]` and `md:w-[56px]`
   are the intended pattern, not a conflict. Only same-variant pairs are.
2. **Ternary branches are alternatives, not siblings.**
   `narrow ? "md:w-[56px]" : "md:w-[214px]"` emits exactly one branch. Collect
   the literals outside ternaries as a base set and check `base ∪ branch` for
   each branch separately. A first attempt that flagged both branches produced a
   false positive on correct code — and a guard that cries wolf gets deleted.

One warning from building it: a pattern that extracts ternaries by cutting at
the `:` will fail on `"md:w-[56px]"`, because Tailwind classes CONTAIN colons.
That version silently passed the very bug the test existed for. Verify a new
guard by re-introducing the historical bugs and watching it fire — a green line
on a guard you have never seen fail says nothing.

## When this does not apply

- **Different variants** (`w-full md:w-1/2`, `hidden md:flex`) — that is the
  intended mechanism, not a conflict.
- **Codebases that route every class string through `twMerge()`** — the last
  class in the string wins there by design, which is the behaviour most people
  expect. The trap is specific to raw concatenation.
- **Utilities for different properties that merely look related** (`w-` and
  `min-w-`, `p-` and `px-`) — those compose.
- **Arbitrary properties** (`[color:red]`) and `!important` variants change the
  comparison; the group-by-property heuristic above will not model them.

## Retrieve before touching a layout component's class string

```ts
search_lessons({ query: "tailwind two utilities same property conflict order", platforms: ["tailwind"] })
```

Related: [[lsn_fixed_modal_zindex_trapped_by_stacking_context]] — a different
CSS trap in the same family, where the written value is also correct and the
rendering still disagrees.
