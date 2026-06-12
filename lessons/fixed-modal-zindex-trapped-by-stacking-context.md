---
id: lsn_fixed_modal_zindex_trapped_by_stacking_context
title: "Inline `fixed inset-0` modals get their z-index trapped by an ancestor stacking context — portal to body"
type: debugging_lesson
tier: community
summary: "A `fixed inset-0 z-50` modal rendered inline paints BEHIND a `z-20` sticky bar when any ancestor creates a stacking context (transform / filter / backdrop-blur / will-change / contain / opacity<1). z-index only orders elements within ONE stacking context, so the trapped overlay sits at the ancestor's ~z-auto level — below the bar. Raising the modal's z-index does nothing; portal the overlay to document.body so it rejoins the root stacking context."
context:
  languages:
    - typescript
  platforms:
    - web
  tags:
    - css
    - z-index
    - stacking-context
    - react
    - portal
    - modal
    - nextjs
    - tailwind
---

## The symptom that looks impossible

A full-screen modal overlay is `position: fixed; inset: 0; z-index: 50` with a
blurred backdrop. A sticky toolbar elsewhere on the page is `position: sticky;
z-index: 20`. When the modal opens, the sticky bar shows THROUGH the backdrop —
`z-50` rendering behind `z-20`, which looks like a browser bug.

It is not. `z-index` does not compare globally. It only orders elements that
share the **same stacking context**. The modal and the sticky bar are in
different contexts, so their raw z-values are never compared against each other.

## Why it happens

`position: fixed` is normally relative to the viewport and joins the root
stacking context. But the moment ANY ancestor has one of these, that ancestor
creates a new stacking context AND becomes the containing block for descendant
`fixed` elements:

- `transform` / `translate` / `scale` / `rotate` (incl. Tailwind `transform`, framer-motion)
- `filter` / `backdrop-filter` (Tailwind `backdrop-blur-*`)
- `will-change: transform|opacity`
- `contain: paint|layout|strict`
- `perspective`
- `opacity` less than 1
- `isolation: isolate`

Now the modal's `z-50` only orders it WITHIN that ancestor card. The card itself
sits in normal page flow at `z-auto` (≈ 0). The sticky bar's `z-20` creates its
own context at level 20 in the page. 20 > the card's ~0, so the entire modal —
backdrop included — paints beneath the sticky bar.

This is easy to hit on dashboards: content cards frequently use `backdrop-blur`
or a framer-motion `transform`, and modals are often rendered inline inside the
card/section that triggered them.

## The fix: portal the overlay to document.body

Render the overlay through a portal so it escapes every ancestor stacking
context and rejoins the root one:

```tsx
"use client";
import { createPortal } from "react-dom";

export function ModalPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null; // SSR guard
  return createPortal(children, document.body);
}
```

```tsx
{open ? (
  <ModalPortal>
    <div className="fixed inset-0 z-50 ... backdrop-blur-sm">
      {/* dialog */}
    </div>
  </ModalPortal>
) : null}
```

`createPortal` moves only the DOM node, not the React tree: React context,
state, and event bubbling through the React parent are preserved. Dark-mode
class strategies that put `.dark` on `<html>` also still apply, because
`<body>` is a descendant of `<html>`.

## What does NOT fix it

- Raising the modal's z-index (`z-[999]`) — it is still trapped inside the
  ancestor context; the ceiling is the ancestor's level, not 999.
- Lowering the sticky bar's z-index — the bar needs it to stay above scrolling
  content; and the real defect is the trap, not the bar.
- Adding `isolation: isolate` to the content column — that contains BOTH the
  modal and the bar, so it does not change their relative order.

## When this does NOT apply

- The overlay already mounts at the app root with no transformed / filtered /
  blurred ancestor (e.g. a top-level layout drawer). Portaling is harmless but
  buys nothing.
- You deliberately want the overlay clipped to a card (an in-card popover, not a
  page-level modal). Then it is not a full-screen modal and this trap does not
  arise.
- Non-DOM renderers (React Native and similar) have a different overlay / z-order
  model — `createPortal(children, document.body)` is web-only.

## Audit checklist

1. Grep for inline overlays: `fixed inset-0` combined with a `z-` class that are
   NOT rendered through a portal.
2. For each, ask: can any ancestor ever get `transform` / `filter` /
   `backdrop-blur` / `will-change` / `contain` / `opacity<1`? If yes (or "maybe
   later"), it is at risk.
3. Prefer a single shared `ModalPortal`/`Dialog` primitive so new modals get
   portal behavior by default, instead of fixing instances one by one.
4. Verify after wrapping: a typecheck/build catches unbalanced JSX; then open a
   modal on a page that has BOTH a sticky bar and a blurred/transformed card and
   confirm the bar disappears behind the backdrop.
