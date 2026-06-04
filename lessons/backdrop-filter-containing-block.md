---
id: lsn_backdrop_filter_containing_block
title: "Fix `fixed` overlay clipped by a `backdrop-filter` ancestor (and dead nested blur) — portal it out"
type: debugging_lesson
tier: community
context:
  languages: [css, typescript]
  platforms: [web]
  tags: [css, backdrop-filter, glassmorphism, position-fixed, containing-block, react, portal, nextjs]
summary: "A sticky/glass nav styled with `backdrop-filter` (backdrop-blur) becomes the containing block for ANY `position: fixed` descendant — so a full-screen drawer with `fixed inset-0` is clipped to the nav's box instead of the viewport. The same ancestor also neutralizes a nested `backdrop-filter`, so a dropdown panel's own blur renders flat. Fix both by portaling the overlay to document.body, out of the backdrop-filtered subtree."
---

## Symptoms

You build a frosted-glass header (`backdrop-blur` / `backdrop-filter`) that contains a dropdown/mega-menu panel and/or a mobile drawer. Two things break, and both look unrelated at first:

1. **Mobile drawer / overlay won't cover the screen.** A child with `position: fixed; inset: 0` is sized and positioned relative to the *nav*, not the viewport — so it "escalates" only inside the 64px header box.
2. **A nested glass panel looks flat.** A dropdown that itself uses `backdrop-blur` does not actually frost the page content behind it; it renders as a near-solid fill.

## Root cause — one property, two consequences

`backdrop-filter` (like `filter`, `transform`, `perspective`, `will-change` on those, and `contain: paint/layout`) does two things to its element:

- **It becomes the containing block for `position: fixed` descendants.** Per spec, these properties create a containing block for fixed-positioned children, so `fixed` no longer resolves against the viewport but against this ancestor's padding box.
- **It establishes a backdrop root.** A descendant's own `backdrop-filter` can only sample the backdrop *up to* that root — i.e. the already-composited (transparent) area inside the ancestor — so a nested blur captures nothing and appears to do nothing.

Both bugs share the same ancestor; they are not two problems but one.

## Fix — render the overlay outside the filtered subtree

Move the overlay out of the backdrop-filtered ancestor so it has no such containing block / backdrop root above it. In React, a portal to `document.body` is the clean tool:

```tsx
"use client";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

function Overlay({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // SSR guard: document only exists client-side
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60]">{children}</div>, // now resolves to the viewport
    document.body,
  );
}
```

- **Full-screen drawer:** a plain portal is enough — `fixed inset-0` now fills the viewport.
- **Anchored dropdown panel:** portal it too, then position with `position: fixed` and a `top/left` computed from the trigger's `getBoundingClientRect()` (recompute on `resize`/`scroll`). Its `backdrop-filter` now frosts the real page content.
- Re-wire interactions that assumed a DOM-contained overlay: outside-click detection must recognize the portaled node (e.g. a `data-*` attribute on it), and hover-intent close timers need the panel's own `onMouseEnter`/`onMouseLeave`.

## Diagnostic

When a `fixed inset-0` element is clipped, or a nested blur looks flat, walk UP the ancestor chain and check computed styles for any of:

```
backdrop-filter (not none) | filter (not none) | transform (not none)
perspective (not none) | will-change: transform/filter | contain: paint|layout|strict
```

The first ancestor with one of these is the culprit. (Tailwind: `backdrop-blur-*`, `blur-*`, `transform`/`scale-*`/`rotate-*`, `will-change-transform`.)

## When this does NOT apply

If the overlay is meant to be contained (a popover that should clip to a card, an in-card sticky element), the containing-block behavior is exactly what you want — keep it inside. Only portal out when the overlay must escape to the viewport or must blur the page content behind it. Related: a portal target needs a client component with an SSR guard — see [[lsn_next_dynamic_ssr_false_client_only]] for the Server/Client boundary.
