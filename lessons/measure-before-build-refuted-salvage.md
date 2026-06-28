---
id: lsn_measure_before_build_refuted_salvage
title: "Refuted headline claim, construct-valid instrument: ship a hygiene check, not the dead claim"
type: workflow_best_practice
tier: community
lesson_class: general
context:
  tools: [claude-code]
  languages: []
  platforms: []
  tags: [epistemics, measure-before-build, product-decision, honest-framing, eval]
summary: A measure-before-build spike can refute a tool's headline claim ("higher score predicts better outcome X") while the scoring instrument itself stays construct-valid (it discriminates good from bad as designed). Don't discard the instrument and don't re-litigate the dead claim — ship it as an honest best-practice/hygiene check, and encode the no-overclaim framing in the copy, the output, AND a test.
---

## The situation

You build a deterministic scorer to test a product premise — e.g. "a
better-scoring artifact causes more of desirable outcome X." Running the
measurement first (measure-before-build) is the right move: it can kill a
weeks-long build on a confounded number in a day. But the result is often
not a clean yes/no:

- The **headline claim is refuted**: a clean A/B test shows no robust
  effect (the early positive signal didn't replicate; it was small-n luck
  or confounded by other channels).
- The **instrument is still construct-valid**: it cleanly separates
  hand-labelled good from bad inputs, with a monotone spread. It measures
  *something real* — just not the thing the headline claimed.

The mistake is treating these as one verdict. "The claim failed, throw it
all away" wastes a valid instrument. "The score still looks predictive to
me" re-asserts a dead claim.

## The move: salvage the instrument, demote the claim

Ship the instrument as what it provably is — a **best-practice / hygiene
check** — stripped of the refuted causal claim:

1. **Reframe the value proposition.** From "improves outcome X" to
   "checks adherence to a known best practice." The good inputs never
   *hurt*; the practice is independently defensible; cost is ~0. That is
   enough to justify a small, honest feature — and only that.
2. **Scope down to what was validated.** If only one dimension of the
   scorer was construct-validated, ship only that dimension active. Leave
   the rest as inactive, documented stubs. Don't smuggle un-validated
   sub-scores in under the validated one's credibility.
3. **Kill the confounded dimensions, not just the claim.** If some
   sub-checks encode your-product-specific vocabulary rather than a
   universal best practice, they'd unfairly penalise an outsider's clean
   input. Drop them from the general check.

## Encode the honesty in three places, not one

A guardrail that lives only in your memory leaks the moment someone edits
the copy. Pin "this is NOT a predictor of X" in all three surfaces:

- **The user-facing copy / tool description**: state plainly it is a
  style/hygiene check, not an outcome predictor.
- **The structured output**: a `note` field on every result repeating the
  non-claim, so it survives even when the description is summarised away.
- **A test**: assert the output text contains the disclaimer and does NOT
  contain a predictive phrasing. This makes a future well-meaning
  "improve the marketing copy" edit fail loudly instead of silently
  resurrecting the dead claim.

## Caveats to keep with the result

- **"Refuted" means "no large effect," not "zero effect."** A small-n
  test (e.g. n=10/cell) cannot exclude a small effect. Record the power
  limitation so nobody reads refutation as proof-of-null.
- **The result is scoped to the regime you tested.** A different model, a
  harder task, or a setting without your confounding channels might show
  a different picture. The honest reframe holds; a revived strong claim
  needs evidence from that other regime, with a higher burden of proof.

## When this does NOT apply

- **The instrument is also invalid** (doesn't discriminate good from bad)
  — then there is nothing to salvage; discard it.
- **The claim was confirmed** — ship the real feature with the real claim.
- **The honest-but-modest feature isn't worth the maintenance** — a
  construct-valid instrument with no claim and no user value is just code
  to maintain. Salvage only when the hygiene framing has genuine, if
  small, value.

## Anti-patterns

- **Re-litigating the refuted claim** because the demoted feature feels
  unexciting. The test you ran already answered it; spend the energy on a
  different-regime experiment if you want the strong claim back.
- **Shipping all dimensions because "they're all reasonable checks."**
  Reasonable ≠ validated, and product-specific ≠ universal. Active checks
  must clear both bars.
- **Putting the disclaimer only in the docs.** Docs get summarised and
  copy gets rewritten; the output field and the test are what keep the
  framing honest over time.

Related: how to actually measure the claim before building it —
[[lsn_agent_self_report_over_llm_judge]]. Surface adjacent eval/epistemics
conventions with `search_lessons({query: "measure before build refuted premise", tags: ["eval"]})`.
