---
id: lsn_flex_min_w_0_horizontal_overflow
title: "Fix horizontal page overflow from a flex/grid child — add min-w-0 (min-width:auto won't shrink below content)"
tier: community
type: debugging_lesson
summary: "A flex (or grid) item defaults to min-width:auto, so it refuses to shrink below the intrinsic width of its widest child — a wide table, chart/canvas, <pre>, or long unbreakable string. In a sidebar+content flex layout this pushes the whole row wider than the viewport and the page scrolls horizontally into empty space. Fix: add min-w-0 (min-width:0) to the flex/grid content column so it can shrink and its children scroll within their own container."
context:
  languages: [css, typescript]
  platforms: [web]
  tags: [css, flexbox, css-grid, layout, overflow, tailwind, responsive]
---

## Symptom

The whole page scrolls **horizontally** (usually to the right) into empty space — there is no content out there. It often feels "always been like this" because it appears on any page whose content happens to contain one wide child. Typical shell:

```html
<div class="flex min-h-screen">
  <Sidebar />
  <main class="flex-1 px-6">{children}</main>
</div>
```

## Cause

A flex item's **default `min-width` is `auto`, not `0`**. `auto` means "do not shrink below the content's intrinsic minimum size." So if any descendant of the `flex-1` column has a large intrinsic width — a fixed/`min-w-[1320px]` data table, a chart/map/canvas with a measured width, a `<pre>` code block, a `white-space: nowrap` row, or a long unbreakable token (URL, hash, ID) — the column expands to fit it and **refuses to shrink**. That pushes the entire flex row wider than the viewport. With no `overflow-x` guard on `<body>`, the overflow becomes a page-level horizontal scrollbar. (Same applies to grid items, whose default `min-width`/`min-height` is also `auto`.)

## Fix

Add `min-width: 0` (`min-w-0` in Tailwind) to the flex/grid item that holds the growing content:

```diff
- <main class="flex-1 px-6">{children}</main>
+ <main class="flex-1 min-w-0 px-6">{children}</main>
```

Now the column can shrink to the available width, and genuinely-wide children either wrap or scroll inside **their own** `overflow-x-auto` wrapper (e.g. wrap tables in `<div class="overflow-x-auto">`) instead of blowing out the whole page. For the vertical analog (a flex/grid child that overflows its parent's height), the equivalent is `min-h-0`.

## Find the offending child

```js
// In DevTools console — logs every element wider than the viewport:
document.querySelectorAll('*').forEach(el => {
  if (el.scrollWidth > document.documentElement.clientWidth) console.log(el);
});
```

Or temporarily add `* { outline: 1px solid red }` and scroll right to spot the element extending past the edge.

## When this does NOT apply

- If a specific element is **explicitly** sized beyond the viewport (`width: 100vw` — which ignores the scrollbar width — a negative margin, or a hardcoded px width), fix that element directly; `min-w-0` on the parent cannot rescue a child that insists on being too wide.
- `min-w-0` lets text collapse/truncate if you were (accidentally) relying on `auto` to keep something from shrinking — pair with `truncate` / `break-words` where that is the intent.
- `overflow-x: hidden`/`clip` on `<body>` hides the *symptom* but not the cause; prefer fixing the flex child so legitimately-wide content still scrolls within its own container.

## Verification

After the fix: `document.documentElement.scrollWidth === document.documentElement.clientWidth` (no horizontal scroll), and wide tables/charts scroll within their own box rather than moving the whole page.