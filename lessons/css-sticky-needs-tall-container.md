---
id: lsn_css_sticky_needs_tall_container
title: "Fix a `position: sticky` element that never sticks — its parent is sized to it, not the scroll area"
type: debugging_lesson
tier: community
lesson_class: general
quality_tier: experimental
context:
  tools: []
  languages: [css]
  platforms: []
  tags: [css, position-sticky, layout, scroll-container, frontend]
summary: "`position: sticky` sticks only within its DIRECT PARENT's box, not the viewport — so if you wrap it in a container sized to just itself (its own `<div>` holding nothing else), it has zero scroll range and never sticks. Make it a direct child of the TALL container holding the content you scroll past. Two more silent killers: an ancestor with `overflow: hidden|auto|scroll` between it and the scroll root, and a missing `top`/`bottom` inset."
problem: "A sticky filter bar didn't stick. It sat in its own wrapper `<div>` whose height equalled the bar — the bar's containing block scrolled away with it, leaving no range to stick across."
solution: "Render the sticky element as a direct child of the tall content container (sticky element first, then the scrollable siblings) so its containing block spans the whole scroll area."
gotchas:
  - "Wrapping the sticky element in a sized-to-content wrapper — the parent IS the sticky range, so a short parent = no stick."
  - "An ancestor with `overflow: hidden|auto|scroll` between the element and the scroll root re-scopes (or clips) the stickiness."
  - "Omitting the `top`/`bottom` inset — `position: sticky` with no offset does nothing."
evidence: "Observed on a Tailwind dashboard: a `md:sticky md:top-4` filter bar only stuck after it was hoisted out of its own `mt-6` wrapper into the shared tall container holding the figures."
last_validated_at: "2026-06-10"
---

## The symptom

You set `position: sticky` plus a `top`/`bottom` offset on an element, but it scrolls away normally — it never sticks.

## Why it doesn't stick

`position: sticky` is sticky **within its containing block — its direct parent's content box**, not the viewport. The element stays pinned only while that parent is in view. Wrap the sticky element in a container sized to *just* the element (its own `<div>` with margin, holding nothing else) and the parent's height equals the element's height → there is no extra range to scroll across → it unsticks immediately. It looks like sticky "doesn't work."

## The fix

Make the sticky element a **direct child of the tall container** it should stick across — the one that also holds the content you scroll past. Sticky element first, scrollable content as following siblings:

```tsx
<div className="space-y-5">      {/* tall: spans the whole scroll area */}
  <FilterBar className="sticky top-4" />
  <Chart />
  <Chart />
</div>
```

Now the bar's containing block spans all the charts, so it stays pinned while you scroll them.

## Other things that silently break sticky

- An ancestor between the sticky element and the scroll root with `overflow: hidden | auto | scroll` re-scopes the stickiness to that ancestor (or clips it) — the most common "works in isolation, breaks in the page" cause.
- No `top` / `bottom` / `left` / `right` inset → `position: sticky` is a no-op (it needs a threshold).

## Confirm quickly

Give the suspect parent a temporary visible border. If the border is only as tall as the sticky element itself, that parent is the problem — hoist the element up to the tall container.

## When this does not apply

- If the element must stay pinned for the whole page regardless of scroll, that's `position: fixed`, not sticky.
- If the wrapping parent genuinely *is* the intended bound (a sticky sub-header inside one tall section), it's already correct.

```ts
search_lessons({ query: "position sticky element not sticking parent height", tags: ["css"] })
```
