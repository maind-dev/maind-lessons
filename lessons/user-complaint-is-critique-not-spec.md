---
id: lsn_user_complaint_is_critique_not_spec
title: "A user complaint critiques the current approach — it is not a spec of the target; don't invert it into one"
type: workflow_best_practice
tier: community
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: []
  tags: [communication, requirements, confirmation-bias, human-in-the-loop]
summary: "When a user complains 'X is too narrow / too dim / wrong', that is a critique of what's on screen now, not a description of the solution. Inferring the target by inverting the complaint, then anchoring on it, leads you to confidently build the wrong thing and dismiss evidence that contradicts the anchor."
last_validated_at: "2026-06-22"
---

## The failure

A complaint describes a defect in the current artifact. It is evidence about what's wrong, not a spec for what's right — and the gap is where agents go astray. "The blue/green/red flanks are too narrow" is a critique of the *current* rendering; it does not mean "the user wants the technique that has narrow flanks." Read literally as a spec, you can invert it into the opposite of what they want.

## Two compounding mistakes

1. **Inverting the complaint into a target.** Taking "feature A looks too X" and concluding "the user wants approach A" — when A is exactly the thing producing the defect and the fix is a different approach.
2. **Anchoring + confirmation bias.** Once you've committed to a hypothesis, you interpret later evidence to fit it — even producing the correct alternative and rationalising it away because it doesn't match the anchor.

## What to do instead

- Separate the two questions explicitly: *what is the defect?* vs *what is the desired end state?* Answer the second from the user, not by negating the first.
- When a complaint is ambiguous about the target, ask one concrete question or show options — don't assume.
- Hold hypotheses loosely. If you produce a candidate that matches the user's described target, that's a signal to test it, not to discard it.
- Don't assert a root cause you haven't verified (a stale cache, an environment mismatch). An unproven cause asserted confidently costs trust, especially when the user can see it's wrong. Verify, then claim. See [[lsn_anti_embellishment_clause]] for the adjacent honesty rule.

## Worked example

A user repeatedly said the coloured flanks of a glow were "too narrow." This was read as "the user wants the smooth-gradient look," and effort went into sharpening that — the wrong direction. The look they actually wanted (a per-edge approach with wide solid flanks) had been produced once and dismissed because it didn't fit the anchored hypothesis. The complaint was a critique of the gradient; the target was its opposite.

## When this does NOT apply

- The user gives an explicit target spec ("make it exactly #9c43fe, 80px wide") — that's a spec, build it.
- The complaint and the target genuinely coincide ("the button should be blue" when it's red) — no inversion risk.

## Verification

After interpreting a complaint, state the *target* back in one sentence and check it with the user before building. If you cannot state the target without negating the complaint, you are inferring — ask.