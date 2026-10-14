---
id: lsn_sr_only_escapes_overflow_hidden_shell
title: "Fix a page that scrolls into empty space below a fixed-height app shell — an sr-only label escapes overflow: hidden"
type: debugging_lesson
tier: community
summary: "In an app shell with a fixed-height, overflow-hidden frame and an inner scroll container, the whole document can still scroll into empty space below the app. Cause: an absolutely positioned element with no positioned ancestor — typically a 1px `sr-only` label deep in a long list — is laid out against the document at its in-flow position, and `overflow: hidden` only clips what is positioned against it. Fix: make the inner scroll container `position: relative`."
context:
  tools: []
  languages: [css, typescript]
  platforms: [web]
  tags: [css, overflow, accessibility, sr-only, layout, scroll-container, app-shell]
---

## Symptom

An app shell is built so the window never scrolls: a frame of `height: 100vh` with `overflow: hidden`, and inside it a content column that scrolls on its own (`overflow-y: auto`). Yet on some pages the **document** scrolls: the app card and side panels slide up and empty background appears below them. The browser's own scrollbar shows at the window edge. Only certain pages are affected, often only once some data is present, so it reads like an unrelated layout change caused it.

## Cause

An `absolute` element's containing block is its nearest **positioned** ancestor. If there is none, it is the initial containing block, the document. When such an element has `top`/`left` set to `auto` (which `sr-only` utilities do), it stays at its **static position**: where it would sit in normal flow.

Put that inside a long inner scroll list and the 1×1px element sits thousands of pixels down, positioned against the document. Two things combine:

- `overflow: hidden` on the frame clips only descendants whose containing block chain passes through it. An element positioned against the document is not clipped by it.
- The inner scroll container is not positioned either, so it does not contain the element.

Result: the document's scroll height grows to the element's bottom edge. Typical culprit: a visually-hidden screen-reader label inside a badge in a long table, board or roadmap.

## Find the culprit

Run in the DevTools console on the affected page. It only reads; it lists absolute elements positioned against the document that end below the viewport:

```js
(() => {
  const H = innerHeight, se = document.scrollingElement, out = [];
  for (const el of document.querySelectorAll("body *")) {
    if (getComputedStyle(el).position !== "absolute") continue;
    const op = el.offsetParent;
    if (op && op !== document.body && op !== document.documentElement) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom + se.scrollTop > H + 1)
      out.push({ tag: el.tagName, cls: String(el.className).slice(0, 120), text: (el.textContent || "").trim().slice(0, 40), bottom: Math.round(r.bottom + se.scrollTop) });
  }
  return { viewport: H, pageHeight: se.scrollHeight, culprits: out };
})()
```

If one culprit's `bottom` equals `pageHeight`, you have found it. SVG elements report no `offsetParent` and show up as false positives; ignore them unless they end at `pageHeight`.

## Fix

Make the inner scroll container the containing block:

```diff
- <div class="min-w-0 flex-1 overflow-y-auto">
+ <div class="relative min-w-0 flex-1 overflow-y-auto">
```

Every absolute descendant without a closer positioned ancestor now resolves against the scroller. A `sr-only` element keeps its static position, so nothing moves visibly, and it can only extend the scroller's own scroll height, where it already is.

Prefer this over patching the one badge: the shell has many `sr-only` labels, and the next one would reintroduce the bug.

## Verification

Reproduced in Chrome with a 100vh `overflow: hidden` frame, an inner `overflow-y: auto` column with 120 rows and one `sr-only` at the end: document height 4,140px at an 813px viewport without the fix, 813px with it. On the real page: `document.scrollingElement.scrollHeight === innerHeight` with the panel open.

## When this does NOT apply

- The document is meant to scroll (no fixed-height shell). Then `sr-only` elements sit inside the scrolling content anyway.
- The culprit is `fixed` or a portal to `<body>`: `relative` on the scroller does not contain those. Size or clip the portal content instead.
- An element with explicit `top`/`left` that was relying on document coordinates: it will move once the scroller is positioned. That was fragile already; use `fixed` for viewport-anchored UI.
- Horizontal overflow into empty space is a different cause: see [[lsn_flex_min_w_0_horizontal_overflow]] and [[lsn_overflow_x_clip_vs_hidden_sticky]].

```js
search_lessons({ query: "page scrolls into empty space sr-only absolute overflow hidden shell", tags: ["css"] })
```
