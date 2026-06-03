---
id: lsn_hybrid_retrieval_eval_query_design
title: "Eval sets for a hybrid retrieval ranker: gate each query at baseline weight; 'keyword-blind' leaks via the field gap"
type: workflow_best_practice
tier: community
lesson_class: general
quality_tier: experimental
context:
  tools: []
  languages: []
  platforms: []
  tags: [search, ranking, hybrid-search, semantic-search, eval, retrieval, test-design]
summary: "Three traps building an eval set for a hybrid (keyword+semantic) ranker. (1) embed text (e.g. title+summary+tags) != keyword haystack (+body), so a 'keyword-blind' paraphrase can leak via a body word — verify blindness by RANK at the keyword-only baseline, not token overlap. (2) Self-validate every query at baseline weight; hard-fail mis-bucketed ones before counting a sweep. (3) Keyword-EXACT watchers are too dominant — use generic thin-margin queries so reordering can surface."
gotchas:
  - "'Keyword-blind' is not 'shares no words with the target'. The embed text and the keyword haystack are different field sets; a query word that appears only in the body still adds keyword score the embed never saw. Define blindness operationally: target rank > k at the keyword-only baseline."
  - "A paraphrase query already at #1 at the baseline weight tests NOTHING (no rescue headroom); a must-stay target NOT at #1 at baseline cannot 'lose #1'. Both are silent eval-set bugs that inflate or flatten your metric. Catch them with a hard-fail gate at weight 0."
  - "Keyword-EXACT must-stay watchers give false confidence: their keyword lead is so large nothing displaces them at any weight. The displacement risk the calibration must measure lives in GENERIC, thin-margin queries where a semantic near-duplicate is the nearest neighbour."
  - "Re-run the gate after any corpus edit. A new doc, or a re-validation that bumps a freshness boost, silently re-buckets queries (a former rank-9 paraphrase becomes rank-4, etc.)."
last_validated_at: "2026-06-02"
evidence: "maind hybrid-ranker eval (2026-06-02): a weight-0 self-validation gate over 28 queries caught 2 mis-bucketed paraphrases (one already #1 -> reclassified must-stay; one leaked keywords via the body -> reworded) before any sweep was counted; the documented quasi-duplicate reorder only surfaced under a generic thin-margin query, not the keyword-exact watchers."
upvotes: 0
---

## Why the eval set is the hard part

Calibrating a hybrid ranker is only as trustworthy as the eval set. Three traps
quietly corrupt the metric before you ever read a number — all three are about
*query construction*, not the ranker.

## Trap 1 — embed text != keyword haystack

A common hybrid design embeds one field set (e.g. `title + summary + tags`) but
keyword-scores over a wider one (e.g. `title + summary + body`). So a paraphrase
you believe is "keyword-blind" can still pick up keyword score from a word that
only appears in the **body** — invisible to your intuition because you wrote the
query against the title/summary.

Define blindness **operationally**: a paraphrase is keyword-blind iff the target
ranks **beyond top-k at the keyword-only baseline** (weight 0). Use a body-token
grep as a *diagnostic* (which query tokens occur in the target body), but the rank
is the gate — incidental overlap is fine as long as it doesn't surface the target.

## Trap 2 — self-validate at the baseline weight, hard-fail mis-bucketing

Classify every query at weight 0 (keyword-only) and refuse to run the sweep until
each is correctly bucketed:

```
paraphrase  -> valid iff baseline rank > 1   (there is rescue headroom)
must_stay   -> valid iff baseline rank == 1  (else it cannot "lose #1")
synonym/mid -> report rank (context only)
```

A paraphrase already #1 tests no rescue; a must-stay not #1 cannot regress. Both
silently distort the metric. The gate converts "I think my eval set is good" into
a checked precondition — see [[lsn_agent_self_report_over_llm_judge]] for the same
"trust a mechanical check, not an assumption" stance.

## Trap 3 — keyword-exact watchers are too dominant; use thin-margin queries

To measure "does a high weight displace a strong keyword hit", keyword-EXACT
queries are the wrong tool: their lead is so large nothing moves them, so the
regression count stays 0 and you conclude "any weight is safe". The real risk is
a **generic, thin-margin** query for which several near-duplicates tie closely and
a semantic near-twin can overtake the keyword #1. Build a few such watchers (one
per dense near-duplicate cluster) so the regression count can actually fire and
locate the breaking weight.

Retrieve this convention when building a retrieval eval:

```
search_lessons({ query: "keyword-blind eval queries hybrid ranker baseline gate thin-margin", tags: ["eval", "hybrid-search"] })
```

## Metrics that survive a no-score API

If your search function returns ranked items without scores, derive everything
from RANK: Recall@k (target in top-k), MRR (1/rank over the full ranking), and
regression (target was #1 at baseline, no longer #1 at weight W). Rank is stable
at any weight>0 because the blended score is keyword-integer + a float term — exact
ties (and load-order tie-break noise) only occur at weight 0, the baseline you are
deliberately not optimizing on.

## When this does NOT apply

- **Graded relevance sets** (human-labelled 0..3 judgments): use nDCG against the
  labels; the baseline-rank bucketing here is a substitute for labels you don't
  have, not a replacement for labels you do.
- **Pure semantic or pure keyword rankers**: trap 1 (field asymmetry) and trap 3
  (explicit-vs-semantic displacement) presuppose a hybrid; they vanish in the pure
  cases.
- **Tiny corpora**: with too few near-duplicates, thin-margin watchers may be
  impossible to construct honestly — say so rather than forcing a weak watcher.
