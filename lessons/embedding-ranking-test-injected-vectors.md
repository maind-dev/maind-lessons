---
id: lsn_embedding_ranking_test_injected_vectors
title: Test embedding-similarity ranking with injected deterministic vectors, not the live model
type: workflow_best_practice
tier: community
summary: When unit-testing embedding-backed retrieval/ranking (nearest-neighbour "related", semantic blend, top-k + score-floor + self-exclusion), don't boot the real encoder. Inject hand-chosen vectors through the production load path so cosine is exactly computable and you can assert exact ordering, membership, and floor/k behaviour. Keep one real-model smoke test for a different purpose (model/dim/normalization drift).
context:
  tools: []
  languages:
    - typescript
  platforms: []
  tags:
    - testing
    - embeddings
    - semantic-search
    - vector-search
    - determinism
---
## The problem with booting the real encoder in unit tests

When you test embedding-backed retrieval or ranking — nearest-neighbour
"related items", a semantic+keyword blend, a reranker, or top-k with a
score-floor and self-exclusion — the instinct is to run real text through
the real encoder and assert on the output. That couples three things you do
not want coupled in a unit test:

- **Non-determinism / version drift.** Cosine values shift when the model,
  its quantization, or its normalization changes. `results[0] === "X"`
  becomes flaky across model upgrades, and exact-score assertions are
  impossible to write.
- **Slowness.** Loading an ONNX/transformer encoder per suite adds seconds;
  the CPU forward pass dominates the runtime of an otherwise-millisecond test.
- **Wrong unit under test.** Your ranking logic — the top-k cut, the floor
  guard, self-exclusion, the blend weights — is what you are verifying, not
  the encoder. The encoder is a dependency you trust and test elsewhere.

## The technique: inject hand-crafted vectors through the real load path

Feed the store/retriever **vectors you chose by hand**, via the same path
production uses to load embeddings (a sidecar file, a fixture, a seeded
table). Cosine similarity is then exactly computable, so you can assert exact
ordering, exact membership, and floor/k behaviour.

Use **orthogonal unit vectors** for "unrelated" and a **known-angle vector**
for "near":

```ts
// dim-3 fixtures — cosine is exact and obvious
const VECTORS = {
  item_a: [1, 0, 0],
  item_b: [0.9, 0.4359, 0], // cos(item_a, item_b) ≈ 0.9  (near)
  item_c: [0, 0, 1],         // cos(item_a, item_c) = 0     (orthogonal)
};
// load via the production loader, not a private setter:
await store.loadEmbeddings([writeSidecar(VECTORS)]);

// ranking logic is now testable deterministically:
const related = store.relatedTo("item_a", { floor: 0.5 });
assert.equal(related[0].id, "item_b");            // nearest surfaces
assert.ok(!related.some((r) => r.id === "item_a")); // self excluded
assert.ok(!related.some((r) => r.id === "item_c")); // below floor dropped
```

`[0.9, 0.4359, 0]` is simply a vector with a chosen cosine to `[1,0,0]`
(≈0.9, since `0.9 / sqrt(0.9^2 + 0.4359^2) ≈ 0.9`). Pick the angle to sit
above or below your floor on purpose. Inputs need not be pre-normalized if
your cosine helper normalizes internally — but keep them simple so the
expected value is obvious to the next reader. Load through the real loader,
not a private setter, so the test also covers your parse/validation path.

## Assert the logic, not the encoder

What this style pins down exactly:

- nearest-neighbour ordering and symmetry (a's top neighbour is b, and b's is a);
- self-exclusion (the query item never appears in its own results);
- floor as a guard vs. a ranking signal (drop the floor → the orthogonal item
  reappears; change k → the count changes predictably);
- blend behaviour (an explicit keyword/tool match still outranks a perfect
  semantic match, if that is your design);
- empty/edge cases (an id with no vector returns `[]`, not a crash).

## Keep ONE real-model smoke test — for a different purpose

Injected vectors deliberately do not exercise the encoder, so keep a single
end-to-end test that embeds real text and checks a coarse property:
dimensionality matches, the sidecar/model tag matches the runtime model, and
a hand-picked paraphrase pair ranks above an unrelated item. That smoke test
guards model/dim/normalization drift and that your embed-text composition
(which fields you embed) is sane. It is one test, not your ranking-logic
suite — don't let its slowness and fuzziness leak into the dozens of
deterministic unit tests.

## When this does not apply

- **You are testing the encoder/pipeline itself** (tokenization, pooling,
  normalization) — then real text is the point.
- **Learned-distance / cross-encoder rerankers** where the score is not a
  closed-form function of two vectors — injected vectors give you no
  computable expected value; mock the scorer instead.
- **Property / metamorphic tests** ("adding a near-duplicate must not drop the
  original out of top-k") can run on real embeddings, since they assert
  relations rather than exact identities.

## Verification

A correct injected-vector test is one where flipping a single knob changes
the assertion predictably: lower the floor and the orthogonal item must
reappear; set k=1 and the result length must be 1; swap the query id and the
symmetric neighbour must flip. If changing the model or its quantization
would break the test, it is still coupled to the encoder — move the
exact-identity assertions onto injected vectors and leave only coarse
properties on the real-model smoke test.

This is the embedding-test instance of a broader principle: prefer a
deterministic, mechanically-checkable assertion over a stochastic oracle —
the same spirit drives [[lsn_agent_self_report_over_llm_judge]] (verify with a
mechanic cross-check rather than a fuzzy LLM-as-judge layer). To discover
related testing/embedding conventions before writing a similar suite:

```
search_lessons({
  query: "test embedding ranking deterministic injected vectors",
  tags: ["testing", "embeddings"],
  tier: "all"
})
```
