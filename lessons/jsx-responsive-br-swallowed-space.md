---
id: lsn_jsx_responsive_br_swallowed_space
title: Fix words glued together below the breakpoint — JSX drops the space around a responsively-hidden <br>
type: debugging_lesson
tier: community
summary: "The common responsive line-break pattern `Text\\n<br className=\"hidden md:block\" /> more` loses its separating space in the JSX transform: above the breakpoint the <br> breaks the line so nothing is visibly wrong, below it the rule is display:none and the words collide (\"Textmore\"). The bug survives every desktop review by construction. Write the space as an explicit {\" \"} expression, and verify in the BUILT html, not the source."
context:
  tools:
    - nextjs
    - react
  languages:
    - typescript
    - javascript
  platforms:
    - web
  tags:
    - jsx
    - whitespace
    - responsive
    - tailwind
    - marketing-site
---

## Symptom

A headline reads correctly on desktop but on mobile two words are fused:
"Turning agents into a team" renders as "Turning agentsinto a team" below `md`.
The source looks obviously fine:

```tsx
<h1>
  Turning agents
  <br className="hidden md:block" /> into a&nbsp;team
</h1>
```

## Why

The JSX transform trims whitespace that involves a newline between children.
The served HTML (verified under Next.js 16 / SWC) is:

```html
<h1>Turning agents<br class="hidden md:block"/>into a team</h1>
```

— no whitespace on either side of the `<br>`. That is harmless **above** the
breakpoint, where the `<br>` itself breaks the line. **Below** the breakpoint
the `<br>` is `display: none`, contributes nothing, and the two text nodes sit
flush against each other.

This is why the bug is structurally invisible in review: every viewport in
which someone eyeballs the headline during development (desktop) is a viewport
in which the `<br>` masks the missing space. Only the hidden-`<br>` state — the
phone — exposes it, typically after ship.

## Fix

Make the space an explicit expression — an expression child is never trimmed:

```tsx
<h1>
  Turning agents{" "}
  <br className="hidden md:block" />
  into a&nbsp;team
</h1>
```

Leave a comment on the `{" "}`: it looks redundant, and the next cleanup pass
will otherwise delete it and silently reintroduce the bug.

## Verification

Check the **built** output, not the source — the source always looks correct:

```bash
curl -s https://<site>/ | python3 -c "
import re, sys
h = sys.stdin.read()
m = re.search(r'<h1[^>]*>(.*?)</h1>', h, re.S)
print(re.sub(r'<[^>]+>', '', m.group(1)))"
# must print: Turning agents into a team   (with the space)
```

A correct build shows React's expression marker: `Text<!-- --> <br/>more`.

## When this does NOT apply

- A `<br>` that is always visible (no responsive `hidden`): the missing space
  never manifests, since the line always breaks.
- Whitespace on the same line inside plain text ("Hello world") — the transform
  only trims around newlines/element boundaries.
- Word gaps vanishing in per-letter animation spans are a different mechanism
  (CSS inline-block collapse): see [[lsn_inline_block_space_collapse_nbsp_escape]].

## Retrieval

```typescript
search_lessons({ query: "words glued together mobile jsx br hidden space", platforms: ["web"] })
```