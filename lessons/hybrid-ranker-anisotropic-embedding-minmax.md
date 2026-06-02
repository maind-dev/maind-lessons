---
id: lsn_hybrid_ranker_anisotropic_embedding_minmax
title: "Tune a hybrid keyword+semantic ranker — min-max normalize anisotropic embedding scores per query, not an absolute floor"
type: workflow_best_practice
tier: community
lesson_class: general
context:
  tools: []
  languages: [typescript, python]
  platforms: []
  tags: [embeddings, semantic-search, rag, ranking, hybrid-search]
summary: "When you add a semantic cosine to an existing keyword ranker, sentence-embedding similarities are anisotropic — clustered in a narrow high band (e.g. bge-small ~0.6-0.8 for ALL items). An absolute similarity floor barely discriminates. Min-max normalize the cosines per query across candidates, add the normalized term to the keyword score, and weight it below explicit field matches so semantic complements rather than replaces."
last_validated_at: "2026-06-01"
---

## Symptom

You bolt a semantic vector score onto a keyword ranker and one of these happens:

- The semantic term seems to do almost nothing (results barely change).
- Or every candidate gets a similar boost (no discrimination).
- Or a tiny floor change flips the whole ordering unpredictably.

## Why

Sentence-embedding cosine similarities are **anisotropic**: they don't spread across `[0,1]`. For many popular models the cosine between a query and *any* document sits in a narrow, high band — measured for `bge-small-en-v1.5`: ~**0.62–0.79** for the whole corpus, related or not. The signal lives in the top ~0.05–0.15 of that band.

So an **absolute floor** (`if cos > 0.4: add k*(cos-0.4)`) is the wrong tool: either every item clears it (no discrimination) or you tune the floor to a razor's edge that breaks on the next model.

## Fix: min-max normalize per query

Compute the cosine for every candidate that has a vector, find the per-query `min`/`max`, and add a normalized term:

```
score += SEMANTIC_WEIGHT * (cos - simMin) / (simMax - simMin)   # only if (simMax - simMin) > eps
```

The nearest candidate gets `+SEMANTIC_WEIGHT`, the farthest `+0` — robust to the compressed absolute range and to swapping the embedding model (different band, same relative order).

Two more rules that keep it a *hybrid*, not a replacement:

1. **Weight below explicit signals.** Keep `SEMANTIC_WEIGHT` under what a deliberate field match (exact tag/tool/language hit) contributes, so an explicit match still wins. Semantic only decides when the keyword signal is weak or absent — exactly the synonym/paraphrase queries it's there for.
2. **Make it additive, not a rewrite.** The semantic term adds to the existing keyword/freshness/tier score; you don't lose the lexical ranking you already trust.

## Verification

Build an eval set of paraphrase queries that share little vocabulary with their target, and compare keyword-only vs hybrid rank of the target:

```
search({query, limit})            # baseline
search({query, queryEmbedding})   # hybrid
```

Expect: keyword-blind paraphrases get rescued into the top-k by the semantic term, while queries the keyword ranker already nails stay put (no regression). Accept that near-duplicate items may swap order at the very top — that is the cost of any semantic signal.

## When this does NOT apply

- **True ANN at scale** (pgvector/FAISS over millions): you let the index do nearest-neighbor and usually don't fuse with a separate lexical score the same way — different architecture.
- **Well-calibrated / contrastively-spread embeddings** where cosines genuinely span a wide range — then an absolute threshold is meaningful and normalization adds little.
- **Reciprocal Rank Fusion (RRF)** is the better fuse when you want to combine two *rankings* and explicitly keep the additive keyword model out of it.

```
search_lessons({ query: "combine keyword and vector search ranking", tags: ["rag", "ranking"] })
```
