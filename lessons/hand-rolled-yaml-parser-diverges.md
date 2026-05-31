---
id: lsn_hand_rolled_yaml_parser_diverges
title: "Diagnose 'accepted here, rejected there': a hand-rolled YAML/frontmatter parser diverges from gray-matter"
type: debugging_lesson
tier: community
context:
  tools: []
  languages:
    - javascript
    - typescript
  platforms: []
  tags:
    - yaml
    - frontmatter
    - validation
    - gray-matter
    - ci
summary: "When one side of a pipeline validates frontmatter with a real YAML parser (gray-matter / js-yaml) and another side uses a hand-rolled 'parses only what we use' mini-parser, valid documents get accepted by the first and rejected by the second. The mini-parser silently lacks YAML features the real one supports — folded block scalars (> and >-), quoting styles, anchors. Fix: run the SAME real parser on both sides of the validation boundary."
last_validated_at: "2026-05-30"
---
## The divergence

A content pipeline often validates the same document in two places — e.g. a dashboard pre-publish check and a CI job in the target repo. If those two validators use different parsers, you get the maddening "passed over here but fails over there" class of bug.

The common cause: one side uses a real YAML library (gray-matter, which wraps js-yaml); the other uses a hand-rolled mini-parser written to "handle only the fields we actually use" and stay dependency-free. The mini-parser inevitably diverges from real YAML:

- **Folded block scalars** `summary: >-` / `>` — a hand-rolled parser that only learned `|` (literal) chokes on `>` and reports "expected key: value" at the continuation line.
- **Quoting** — single vs double, escaped characters.
- **Anchors, flow maps, multi-line plain scalars** — rarely implemented by hand.

Each missing feature is a document the real parser accepts and the mini-parser rejects. As authors use more YAML, the divergence surfaces as new "false" failures.

## The fix

Use the SAME real parser on both sides. In Node, `gray-matter` (or `js-yaml` directly) is small and ubiquitous; the cost is one dependency plus an install step in the CI job. That buys parity: whatever the producer accepts, the consumer accepts.

```bash
# CI step that previously ran a zero-dep node script now installs the parser first:
npm install gray-matter
node scripts/validate.mjs
```

Watch one edge: js-yaml may coerce an unquoted `YYYY-MM-DD` to a Date object (where the hand-rolled parser kept a string). If a downstream check does `typeof x === 'string'`, tolerate Date too, or pin the JSON schema.

## When this does not apply

- If the two validators are intentionally different gates (structural Zod schema vs a security/injection scan), keep them separate — this is about the *parsing* layer diverging, not the rule layer.
- A truly dependency-free environment (no install possible) may justify a hand-rolled parser — but then document its supported-syntax surface and test it against the real parser's output.
