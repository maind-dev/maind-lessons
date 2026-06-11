---
id: lsn_overflow_x_clip_vs_hidden_sticky
title: "Fix page horizontal-scroll: contain it with overflow-x: clip, not hidden (hidden breaks position: sticky)"
tier: community
type: debugging_lesson
summary: "A too-wide descendant can escape its flex/grid item and scroll the whole page even after min-w-0 fixed the item's sizing. The robust guard is overflow-x: clip on a scoped container — NOT hidden: hidden creates a scroll container that breaks position: sticky descendants and is programmatically scrollable; clip just clips and pairs with overflow-y: visible. Give content that must scroll its own overflow-x-auto; find the culprit via getBoundingClientRect().right > clientWidth."
context:
  languages: [css, typescript]
  platforms: [web]
  tags: [css, overflow, layout, position-sticky, flexbox, responsive]
---

## Symptom

The page scrolls horizontally into empty space; in a sidebar layout, scrolling right pushes the sidebar off-screen. You already added `min-w-0` to the flex/grid child (correct — that's the companion fix for "a flex item won't shrink below its content") but the page STILL scrolls right. And when you reach for `overflow: hidden` to stop it, a sticky header/toolbar elsewhere stops sticking.

## Why min-w-0 isn't always enough

`min-w-0` stops a flex/grid item from being **forced wider** by its content, so the item sizes correctly within the row. But it does NOT clip a descendant that is *explicitly* too wide — a fixed-width element, a `white-space: nowrap` cell, an absolutely-positioned tooltip, a `transform`. Such a child still **overflows the item's box**, and with no `overflow` guard up the tree (and no `overflow-x` on `<body>`), it spills into document-level horizontal scroll. So the flex row is sized right, yet the body scrolls and the sidebar drifts off-screen.

## Fix: clip a scoped container — with `clip`, not `hidden`

Put `overflow-x: clip` (Tailwind `overflow-x-clip`) on the page/section container that wraps the offending subtree. Use **`clip`**, not `hidden`:

| | `overflow-x: hidden` | `overflow-x: clip` |
|---|---|---|
| Clips overflow | yes | yes |
| Creates a **scroll container** | **yes** | **no** |
| Breaks `position: sticky` descendants | often (they stick to this box, not the viewport) | no |
| Programmatically scrollable (focus/JS can scroll it) | yes | no |
| Valid with `overflow-y: visible` | no (`visible` computes to `auto`) | **yes** |

Because `clip` creates no scroll container, sticky toolbars inside keep sticking to the viewport, and the browser can't accidentally scroll the clipped axis (e.g. when an off-screen child gets focus). `overflow-x: clip` + `overflow-y: visible` is a valid pair; `overflow-x: hidden` forces the visible axis to `auto`.

**Don't clip content that must scroll.** Anything that legitimately needs horizontal scrolling — a wide data table, a code block — must keep its **own** `overflow-x-auto` wrapper; that inner scroll container works fine inside the outer `clip`. Clipping the outer container is only safe when its overflow is "empty" (phantom width); if real content lives in the overflow, fix the child instead (`overflow-x-auto` wrapper, `max-w-full`, `truncate`).

## Locate the real culprit (when you can't eyeball it)

```js
// DevTools console — logs every element whose right edge exceeds the viewport:
const w = document.documentElement.clientWidth;
[...document.querySelectorAll('*')]
  .filter((el) => el.getBoundingClientRect().right > w + 1)
  .forEach((el) => console.log(Math.round(el.getBoundingClientRect().right), el));
```

The deepest/smallest logged element is usually the offender — fix it precisely (`min-w-0` / `max-w-full` / own `overflow-x-auto`) and you may not need the container clip at all. The clip is the robust fallback when the source is elusive or you can't reproduce it locally.

## When this does NOT apply

- If `min-w-0` (or fixing the specific child) fully resolves it, don't add a clip — prefer the precise fix.
- Don't blanket-`clip` a container that holds content meant to be scrolled horizontally at the page level — you'd cut it off. Give such content its own scroll container.
- `overflow: clip` needs an evergreen browser (Chromium/Firefox/Safari since ~2022). For very old targets, fall back to `hidden` and accept the sticky trade-off (or isolate the sticky element outside the clipped subtree).

## Verification

`document.documentElement.scrollWidth === document.documentElement.clientWidth` (no page scroll); a sticky toolbar inside the clipped container still sticks on vertical scroll; wide tables still scroll within their own box.