---
id: lsn_heuristic_normalization_symmetry
title: "Fix asymmetric normalization in string-match heuristics — strip both sides identically"
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools: []
  languages: [sql, typescript, python, javascript]
  platforms: []
  tags: [heuristics, string-matching, normalization, silent-failure, substring-match]
summary: "When a heuristic compares two strings via substring/equality after normalization, BOTH sides MUST run through identical normalization. Asymmetric stripping produces deterministic false-negatives for inputs containing those characters: 'amsosram' LIKE '%ams-osram%' is FALSE because the slug stripped the hyphen but the pattern kept it. Diagnostic: heuristic works for clean inputs but fails reliably for a subclass (hyphens, accents, zero-width chars, etc.)."
---

## Symptom

A string-matching heuristic returns the wrong answer for a specific input class while working correctly for everything else. The failure is **deterministic and silent** — no error, just wrong output.

Real-world example (Postgres function):

```sql
-- Goal: match an organization name against the user's e-mail domain
v_norm_name   := regexp_replace(lower(trim(p_name)), '[^a-z0-9]', '', 'g');  -- 'ams-osram' → 'amsosram'
v_first_label := split_part(lower(trim(p_domain)), '.', 1);                   -- 'ams-osram.com' → 'ams-osram'
return v_norm_name like '%' || v_first_label || '%';
-- 'amsosram' LIKE '%ams-osram%' → FALSE   ← bug: hyphen mismatch
```

Result: every user whose e-mail domain contains a hyphen (`ams-osram.com`, `t-online.de`, `e-on.com`, `t-mobile.com`, `web-dev.io`, `co-op.com`, ...) gets a false-negative — the heuristic refuses to match even when the name is clearly derived from the domain.

## Why it happens

Two independent normalization pipelines that **look identical at a glance** but differ in their character-class scope:

| Side | Pipeline | Effect on `'ams-osram'` |
|---|---|---|
| Name slug | `regexp_replace('[^a-z0-9]', '', 'g')` | hyphen stripped → `'amsosram'` |
| Domain label | `split_part(..., '.', 1)` only | hyphen retained → `'ams-osram'` |

The slug is now a strict subset of the original char-set; the pattern is not. Substring-search `slug LIKE '%pattern%'` cannot succeed when pattern contains chars that were guaranteed-removed from slug.

The bug class generalizes to many normalization steps:

| Normalization | If asymmetric, fails on |
|---|---|
| `[^a-z0-9]` stripping | inputs with hyphens, underscores, dots, spaces |
| Unicode NFC vs NFD | inputs with combining characters (é, ñ) |
| Case-folding | inputs with non-ASCII letters (ß, ı, İ) |
| Whitespace trimming | inputs with leading/trailing spaces |
| Accent stripping | inputs from non-English alphabets |
| Zero-width char removal | inputs from copy-paste with U+200B/U+200C |
| Punctuation removal | inputs with apostrophes (O'Brien), periods (St.) |

Each is silent in the same way.

## Fix

Apply the **same normalization function** to both sides — either via a shared helper, or by inline repetition with an anchoring comment:

```sql
-- Inline-symmetric. The comment is load-bearing — any change to the regex
-- MUST be applied symmetrically on the other side.
v_norm_name   := regexp_replace(lower(trim(p_name)),   '[^a-z0-9]', '', 'g');
v_first_label := regexp_replace(                                                  --
  split_part(lower(trim(p_domain)), '.', 1),                                      --  must match v_norm_name's regex
  '[^a-z0-9]', '', 'g'                                                            --  (asymmetric stripping → silent false-negatives)
);
```

Or via a helper if the normalization is reused in N+ sites:

```typescript
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const slug = normalize(orgName);
const labels = domain.split(".").map(normalize).filter((l) => l.length > 0);
return labels.some((label) => label.length >= 3 && slug.includes(label));
```

When the same heuristic exists in BOTH a server function and a frontend mirror (e.g., a DB function for authority + a TS function for instant UX hints), the symmetry constraint applies on **two axes**: (a) left-vs-right inside each implementation, AND (b) server-vs-client between the two implementations. The frontend-mirror axis is covered by `[[lsn_edge_frontend_interface_mirror]]`; the same discipline applies to algorithmic mirrors, not just data-shape mirrors.

## When this workflow applies

- Any heuristic doing **substring or equality match** between two strings after normalization.
- Slug/handle/identifier comparison (org-name vs domain, username vs email, brand vs product).
- Fuzzy lookup, dedup, search-result-matching.
- Mirror implementations: when a DB function and its frontend cousin both implement the same heuristic — verify symmetry on both axes.

## When NOT to use this workflow

- **Full-text search** (PostgreSQL `to_tsvector`, Elasticsearch, etc.) — those have their own document- and query-normalization rules that intentionally differ (stemming on the document, stop-word handling on the query). Don't apply this convention there.
- **Exact-match** with no normalization at all — if you're comparing UUIDs or hashes byte-for-byte, normalization symmetry isn't a concern; just match raw.
- **Asymmetry by design** — e.g. tolerant input on one side (`'  Acme  Corp  '`) vs strict stored canonical form (`'acme-corp'`). When asymmetry IS the intent, document it loudly in code comments and tests, because the next reader will assume it's a bug.

## Diagnostic recipe

When a string-match heuristic returns wrong answers for a specific input class:

```
1. Identify the failing input class — what character do all failing inputs share?
   (hyphens? non-ASCII? leading whitespace? specific Unicode block?)

2. Trace both sides of the comparison through their normalization pipelines.
   Write down the intermediate values for one failing input. Look for the
   character of step (1) appearing in one pipeline's output but not the other.

3. Pick the more aggressive pipeline and apply it to the other side.
   Aggressive = strips more characters = produces shorter normalized form.

4. Re-test the failing input + the working inputs to confirm no regression.
```

The diagnosis is mechanical once you know to look for it — the asymmetric pipeline shows up immediately when you write down the intermediate states.

When an agent encounters a string-match heuristic failure that fits the symptom-fingerprint above, the convention is one search away:

```typescript
search_lessons({
  query: "asymmetric normalization substring match heuristic",
  tags: ["heuristics", "silent-failure"],
});
// → returns this convention with the diagnostic recipe.
```

Companion convention for the broader mirror-discipline (data-shape mirrors between server payload and frontend display): `[[lsn_edge_frontend_interface_mirror]]`.