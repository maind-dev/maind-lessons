---
id: lsn_mockup_labels_pinned_both_ways
title: "Pin every product label a mockup shows to the file that renders it, and check the pin in both directions"
type: workflow_best_practice
tier: community
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [web]
  tags: [product-demo, mockups, drift, ci, silent-failure]
summary: "Marketing demos, product tours and screenshots rebuilt in code copy product labels verbatim, then drift silently when the product renames one: the mockup file never changes, so no review sees it. Pin each label to the product file that renders it and fail CI when the source loses the label or no mockup shows it any more. Strip comments and normalise whitespace on both sides."
last_validated_at: "2026-10-13"
---

## Why mockups drift without anyone noticing

A landing-page demo of your dashboard, a guided tour, a terminal animation of your CLI — they are most convincing when they show the real labels. Then the product moves on: a navigation item is renamed, a CLI message is reworded. The mockup still shows the old text. Code review cannot see it (the mockup file is not in the diff), tests cannot see it (both sides are correct on their own), and visitors see a product that does not exist. On one product website this happened three times in two months before a guard existed.

## The pin and its two directions

Keep a list of pins — one per label the mockup shows — each naming the product file that renders it:

```json
{ "pins": [
  { "label": "Agent sessions", "source": "apps/dashboard/src/nav/registry.ts" },
  { "label": "Review queue",   "source": "apps/dashboard/src/nav/registry.ts" }
] }
```

Check each pin both ways:

1. **The source still contains the label.** If not, the product changed and the mockup lies — this one should fail the build.
2. **Some mockup still shows the label.** If not, the pin guards nothing. It would pass direction 1 forever and read as coverage that no longer exists — warn, and delete the pin.

Two normalisations, applied to texts **and** to the label (an asymmetric one is a silent false negative, see [[lsn_heuristic_normalization_symmetry]]): strip comments, because a label that survives only in a comment is not rendered; and collapse whitespace, because JSX text breaks across lines.

## A minimal check

```js
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const norm = (s) => s.replace(/\s+/g, " ");
// Simplified: `//` only opens after start/whitespace/punctuation, so `https://…`
// in JSX text survives. Track quotes for anything stricter.
const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}()=,])\/\/.*$/gm, "$1");
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (statSync(p).isDirectory()) return walk(p);
  return /\.(tsx?|jsx?|json)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
});

const { pins } = JSON.parse(readFileSync("site/labels.json", "utf8"));
const mockups = walk("site/tour").map((f) => norm(strip(readFileSync(f, "utf8"))));
const problems = [];
for (const { label, source } of pins) {
  const want = norm(label).trim();
  let text;
  try { text = norm(strip(readFileSync(source, "utf8"))); }
  catch { problems.push(`${source} is gone (pinned for "${want}")`); continue; }
  if (!text.includes(want)) problems.push(`"${want}" is no longer in ${source}`);
  if (!mockups.some((t) => t.includes(want))) problems.push(`"${want}" is pinned but no mockup shows it`);
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
```

Run it in CI on every change to the product sources **and** the mockups — the product side is the one that drifts. If you use the maind CLI, the same check is built in as the detector `det_mockup_label_drift`: declare the sets in `.maind/mockup-labels.json` (pins file, `source_root`, mockup path prefixes) and `maind gate` runs it, grades it against the merge-base and reports a rename right at the edit through the bridge's write hook.

## Verification

Break it on purpose before trusting it: rename a pinned label in the product source (must fail), remove a label from the mockup (must warn), point a pin at a moved file (must fail). Make the break real — the check is a substring test, so `Triage` → `Triagex` still contains `Triage` and proves nothing; `Tri-age` does.

## When NOT to use this

- Mockups that deliberately show fictional UI (a concept, a roadmap preview) — pin only what claims to be the real product.
- Labels computed at runtime (counts, user names, dates) — pin the constant they come from, or leave them out.
- It checks text, not appearance: layout, colour and icons can drift without a finding.

Related search: `search_lessons({ query: "marketing mockup labels drift from product", tags: ["product-demo"] })`.
