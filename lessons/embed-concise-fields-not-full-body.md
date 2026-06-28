---
id: lsn_embed_concise_fields_not_full_body
title: "Embed title + summary + tags for retrieval, not the full document body — short queries match concise fields better"
type: workflow_best_practice
tier: community
lesson_class: general
context:
  tools: []
  languages: [typescript, python]
  platforms: []
  tags: [embeddings, rag, retrieval, indexing, semantic-search]
summary: "When indexing documents for semantic search and the queries are short symptom/intent paraphrases, embedding the whole body dilutes the high-signal 'what + why' (title, summary, tags) with solution prose, code, and edge-cases. Embed a concise composite (title + summary + tags) instead — it aligns better with short queries and fits the model's token window without truncation."
last_validated_at: "2026-06-01"
---

## The choice

For each document you index, you decide what text to feed the embedding model. The tempting default is "embed everything" (title + body). For a corpus searched by short, intent-level queries, that is usually the wrong call.

## Why concise beats full-body

- **Query/passage length mismatch.** A user query is ~5–15 words describing a *symptom or intent*. A document body is hundreds of words of *solution detail, code, and caveats*. Mean/CLS-pooled embeddings average over all tokens, so a long body pulls the vector toward its bulk (the solution), away from the problem statement the query actually paraphrases.
- **Signal density.** The title + a one-line summary + tags are the curated "what problem, why it matters" — exactly what a paraphrase query targets. Embedding those keeps the vector pointed at the retrievable concept.
- **Token limit.** Most sentence-embedding models truncate at 256–512 tokens. A long body gets silently cut anyway; you don't control *where*. A concise composite fits whole.

## Recipe

```
embedText = [title, summary, tags.join(" ")].join("\n")
```

Keep a stable, documented composition (and re-embed the whole corpus if you change it — vectors built from different compositions aren't comparable). If a document has no summary, synthesize a one-liner at index time rather than dumping the body.

## When this does NOT apply

- **Long-document QA / passage retrieval** where the answer is buried in the body — then you *chunk* the body and embed each chunk, rather than embedding a concise abstract. Different problem (find-the-passage, not find-the-document).
- **Code search** where the body *is* the query target (you search for an implementation, not a description).
- **Models trained for long-context retrieval** (e5-long, nomic-embed long) where body dilution is less pronounced — still test concise vs full on your own eval set.

```
search_lessons({ query: "what text to embed for document retrieval", tags: ["rag", "embeddings"] })
```
