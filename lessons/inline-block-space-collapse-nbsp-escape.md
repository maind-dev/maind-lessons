---
id: lsn_inline_block_space_collapse_nbsp_escape
title: "Fix vanishing word gaps in per-letter inline-block text — render spaces as a ` ` escape, not a literal char"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [web]
  tags: [css, inline-block, whitespace, text-animation, react]
summary: "When you split text into one `inline-block` span per character (for per-letter animation), the spaces between words disappear: a normal space is the leading/trailing whitespace inside its own inline-block and collapses to zero width. Render the space as a non-breaking space — and write it as the ASCII escape `\\u00a0`, not a literal nbsp character, because a literal nbsp silently reverts to a normal space on many editor/formatter/AI-rewrite passes and the gap regresses."
problem: |
  Splitting a phrase into animated per-letter spans. The space is mapped to a
  span too:

  ```tsx
  {Array.from("the same lessons").map((ch, i) => (
    <span key={i} style={{ display: "inline-block" }}>
      {ch === " " ? " " : ch}   {/* a normal 0x20 space */}
    </span>
  ))}
  ```

  Renders as `thesamelessons` — words run together. The space is the only
  content of its `inline-block`, so as leading-and-trailing whitespace it
  collapses to zero width.
solution: |
  Render the gap as a non-breaking space, written as the ASCII escape:

  ```tsx
  const NBSP = " "; // escape, NOT a literal nbsp character
  // ...
  {ch === " " ? NBSP : ch}
  ```

  ` ` does not collapse, so the gap keeps the font's space width. Keep it
  as the six-character escape in source: a literal nbsp glyph looks identical
  to a normal space in the editor and is silently rewritten to `0x20` by
  formatters (Prettier), "trim trailing whitespace", AI rewrites and
  copy-paste — and the instant it does, the gap collapses again. The escape is
  immune.
gotchas:
  - "The comparison stays a NORMAL space: `ch === \" \"` must match the 0x20 in your text; only the REPLACEMENT is the nbsp escape. Comparing against a literal nbsp would never match."
  - "Verify by bytes, not by eye: `grep ... | od -c` shows `302 240` for a real U+00A0 and a blank for a 0x20 space — they are visually indistinguishable in the editor."
  - "The same collapse hits flex/grid layouts of per-letter spans. `white-space: pre` on the container is an alternative but changes wrapping behaviour."
last_validated_at: "2026-06-03"
---

## When this bites

Any per-letter or per-word splitter where each unit is `inline-block` (or a
flex/grid item) and the separating space is mapped to its own element — flip
text, typewriter effects, staggered reveals. Single-word animations never hit
it (no spaces); it only appears once the animated string contains a space.

## Why the escape, not the literal char

At runtime a literal U+00A0 and the escape ` ` are identical. The
difference is SOURCE durability: a literal nbsp is indistinguishable from a
normal space on screen, so formatters, editor whitespace-trimming, AI-assisted
rewrites and copy-paste readily turn it back into `0x20` — silently regressing
the fix. The escape sequence is plain ASCII and survives all of those.

## When this does NOT apply

If spaces are not their own collapsing box — you keep whole words as one inline
element and only animate within words, or you set `white-space: pre`/`pre-wrap`
on the container — the normal space is preserved and the nbsp is unnecessary.

## Verification

`grep "NBSP" <file> | od -c` — a correct escape shows the ASCII bytes
`" \ u 0 0 a 0 "`; a literal char shows `302 240`; a regressed normal space
shows a blank. Visually, the rendered text should show its word gaps again.
