---
id: lsn_subagent_mass_edits_via_script
title: Use a deterministic script (not a sub-agent) for mass edits over ~10 sites with identical mechanics
type: workflow_best_practice
tier: community
lesson_class: general
quality_tier: hand-vetted
context:
  tools:
    - claude-code
    - cursor
  languages:
    - bash
    - python
  platforms: []
  tags:
    - sub-agents
    - mass-edits
    - automation
    - deterministic-tasks
summary: >-
  Sub-agents are valuable when the task needs judgement — adapting to
  different file structures, deciding what to keep, weighing tradeoffs.
  For deterministic mass-edits (rename a constant across 30 files,
  swap an import path everywhere, normalise whitespace in a tree),
  a sub-agent introduces non-determinism without adding value. A
  shell or Python script is cheaper, faster, and 100% verifiable.
  The break-even is ~10 sites with identical mechanics.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The trade-off

Sub-agents are good at: reading many files and synthesising patterns, making local judgement calls ("which of these duplicates is the canonical one?"), adapting a generic instruction to varied concrete shapes.

Sub-agents are bad at: doing the same trivial mechanic 30 times without missing any, reporting honestly when they skipped one, being verifiable after the fact (the success-message is a free-text claim, not a proof).

For a mass-edit where the mechanic is identical at every site, the "adapt" capability is wasted and the "verify" weakness is exposed. The right tool is a script.

## The threshold

Roughly: **~10 sites with the same mechanic** is where a script overtakes a sub-agent. Below that, the script-writing time costs more than the sub-agent costs. Above that, a script:

- Runs in seconds, not minutes
- Produces a deterministic diff you can audit visually
- Doesn't need a verification pass (the script's behaviour IS the verification — `grep` after to confirm zero misses)
- Doesn't lie when something goes wrong (a script that crashes is more honest than a sub-agent that says "done!" while having skipped 3 files)

`~10` is a heuristic. Adjust to the project. The principle is: **if you can write the script in less time than the sub-agent would spend on the task, write the script.**

## Concrete examples

Use a script:

- Rename `getCwd` → `getCurrentWorkingDirectory` across 28 files → `find . -name '*.ts' -exec sed -i '' 's/\bgetCwd\b/getCurrentWorkingDirectory/g' {} +`
- Change every i18n locale code from `'en-US'` → `'en'` across all translation files → 10-line Python script with `json.dump`
- Add a copyright header to every newly-created file in a directory → shell script

Use a sub-agent:

- "Audit this 80-file directory and tell me which ones still reference the deprecated `useAuthV1` hook, then propose the right migration for each" — needs judgement per file.
- "Find places where we accidentally exposed service-role keys in the client bundle" — judgement on what counts as "accidental".
- "Review this 12-file PR for security issues" — pattern-matching on adversarial possibilities, not a mechanical sweep.

## The verification trap

Even with the "use a script" rule, mass-edit operations need a post-step. Sub-agents have been observed to report "done!" when they edited 12 of 15 files — see related `lsn_subagent_mass_edit_verification`. Scripts can also fail partially. Always run:

```bash
grep -rn 'getCwd' . --include='*.ts' --include='*.tsx' | head
grep -rn 'getCurrentWorkingDirectory' . --include='*.ts' | wc -l
```

A zero-hit grep for the old pattern is the strongest evidence the edit landed everywhere it should.

## When this does not apply

- **You don't know the exact pattern.** If you can't write the regex or the find-replace, you can't write the script. Use a sub-agent to find the pattern first, then a script to apply it.
- **Each site needs a different decision.** If 12 of 30 sites should use one replacement and 18 should use another, that's judgement — sub-agent territory.
- **The mechanic involves something a script can't do reliably.** Editing AST across multiple languages, refactoring with type-safety guarantees — sometimes these are better done with `ast-grep`, `comby`, or LSP-driven tools rather than `sed`.

## Verification

After any large mass-edit task (script or sub-agent), three checks:

```bash
# 1. Old pattern fully removed
grep -rn '<old-pattern>' <scope> | wc -l   # should be 0

# 2. New pattern count plausible
grep -rn '<new-pattern>' <scope> | wc -l   # should match the expected site count

# 3. File extensions intact
find <scope> -type f -newer /tmp/before-edit -print | \
  grep -v -E '\.(ts|tsx|js|md|json)$'      # should be empty
```
