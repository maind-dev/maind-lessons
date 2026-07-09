---
id: lsn_css_3d_transform_inline_block_descender_clip
title: "Fix clipped descenders (g, y) on 3D-transformed inline-block text — pad the letter, negate the margin"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: []
  languages: [typescript, javascript, css]
  platforms: [web]
  tags: [css, transform, animation, inline-block, typography]
summary: "A 3D-transformed `inline-block` (e.g. `rotateX`/`preserve-3d` for per-letter flip text) becomes its own composited layer, clipped to its border box. Under a tight headline `line-height` that box is shorter than the glyph, so descenders (g, y, j) clip — though plain untransformed text on the same line is fine. Fix: equal vertical padding per letter (room in the layer) + an equal negative margin (layout/baseline unchanged)."
problem: |
  Per-letter flip animation. Each letter is an `inline-block` so it can be
  3D-rotated, inside a tight-leading headline:

  ```tsx
  <h1 className="text-6xl leading-[1.05]">
    {Array.from(word).map((ch, i) => (
      <span key={i} style={{ display: "inline-block",
                             transformStyle: "preserve-3d",
                             transform: "rotateX(20deg)" }}>
        {ch}
      </span>
    ))}
  </h1>
  ```

  The bottoms of `g`, `y`, `j` (and sometimes the tops of tall glyphs) are
  visibly cut off. The same headline as plain text — no per-letter spans, no
  transform — shows the descenders fine.
solution: |
  Add equal vertical padding to each transformed letter so its border box (=
  the composited layer) contains the full glyph, then cancel that padding with
  an equal negative margin so layout and baseline are unchanged:

  ```tsx
  const letter: React.CSSProperties = {
    display: "inline-block",
    transformStyle: "preserve-3d",
    paddingTop: "0.3em",
    paddingBottom: "0.3em",
    marginTop: "-0.3em",
    marginBottom: "-0.3em",
  };
  ```

  The padding gives the composited layer head/foot room; the negative margin
  removes that room from flow, so the line box, baseline and surrounding text
  don't shift. Keep `overflow` visible (don't add `overflow:hidden` on an
  ancestor — that re-introduces clipping).
gotchas:
  - "The clip is the composited LAYER (border box), not normal overflow — that is why untransformed text on the same line is unaffected and why no ancestor has `overflow:hidden`. Padding the element's own box is the lever."
  - "Use `em` (not `px`) for the pad so it scales with responsive font-size changes (e.g. a hero headline that grows at larger breakpoints)."
  - "`background-clip: text` gradients are unaffected — padding adds no glyphs, so the gradient still clips to the letter shapes."
last_validated_at: "2026-06-03"
---

## When this bites

Per-character or per-word animation (flip, wave, reveal) where each unit is an
`inline-block`/`block` with a `transform` (`rotateX/Y`, 3D) inside a heading
with tight `line-height` (common in hero headlines: `leading-[1.05]` or less).
The tighter the leading and the larger the type, the more of the descender is
lost.

## Why it clips (and why plain text doesn't)

A transformed element is painted into its own GPU compositing layer whose
bounds are the element's border box. With `line-height: 1.05` the border box is
~1.05em tall, but a glyph with a descender spans more than that around the
baseline, so the overhang is clipped to the layer. Untransformed inline text is
not promoted to a layer, so its descenders simply overhang the line box and
remain visible.

## When this does NOT apply

If the letters are not transformed (no `transform` / `preserve-3d`) there is no
composited layer and nothing to clip — don't add the padding hack reflexively.
Likewise if the line-height is already generous enough to contain the glyph,
the layer box is tall enough and the fix is unnecessary.

## Verification

Toggle the per-letter `transform` off: the clipping disappears (confirming it
is the layer, not overflow). With the padding + negative-margin in place the
transform stays on and `g`/`y` render in full, with no baseline shift versus
the surrounding words.
