---
id: lsn_diagnostics_need_a_real_captured_failure
title: Test a diagnostic against a real captured failure state, not only synthetic fixtures
type: workflow_best_practice
tier: community
summary: >
  A checker whose unit tests are all green can still be wrong the first time it
  runs against a real captured instance of the problem it was built for. The
  fixture is written from the same mental model as the code, so a wrong model
  produces a fixture that agrees with it; and a test can exercise a branch that
  an upstream fallback prevents the real pipeline from ever reaching. Keep a
  small corpus of real captured failure states.
context:
  tools:
    - claude-code
    - cursor
  languages: []
  platforms: []
  tags:
    - testing
    - diagnostics
    - fixtures
    - verification
    - false-confidence
---

## The failure mode

You write a checker — a drift detector, a config linter, a health probe, a
migration validator. You write its unit tests. Every branch is covered, every
test is green. Then you run it once against a **real** captured instance of the
problem it was built for, and it is wrong.

Not wrong in an uncovered branch. Wrong in a covered one, because the synthetic
fixture and the real artifact differ in a way the fixture's author could not
have imagined — that is precisely why the bug exists in the first place.

Two mechanisms produce this, and both are invisible from inside the test suite:

**1. The fixture is written from the same mental model as the code.** Both come
from one head, one sitting. If the model is wrong, the fixture is wrong in the
same direction and agrees with the code. A green test then measures
self-consistency, not correctness.

**2. The test exercises the branch, not the path that reaches it.** Passing
`{age: null}` straight into a classifier tests what the classifier does with
null. It does not test whether anything in the real pipeline ever produces
null — and if a fallback silently substitutes a plausible-but-wrong value
upstream, the branch is dead code while its test stays green.

## Two measured examples

**A remedy that was a no-op.** A drift checker classified a config entry as
stale and advised "re-run the installer". Synthetic tests: green. Run against
the user's actual backed-up config file: the advice was wrong, because the
installer was append-only — against an existing entry it matches, skips, and
changes nothing. The tool would have sent every affected user to a command that
politely does nothing. No synthetic fixture exposed this, because the fixtures
tested *classification*, and the defect was in the *advice attached to* the
classification.

**A silent fallback that ate the signal.** A release-drift detector dated a
version bump via `git log -S<version-string>`, and fell back to "last commit
touching the manifest" when that found nothing. A unit test asserted "unknown
age means report it, don't stay silent" — and passed, because it injected the
unknown directly. In the real pipeline the fallback manufactured a *recent*
date instead, the grace period absorbed it, and the detector went quiet in
exactly the case it existed for. Found on the first end-to-end run, never by
the suite.

## The practice

**Keep a small corpus of real captured failure states and run new diagnostics
against them.** Not many — a handful is enough, and they age well because a
real broken artifact stays broken in its own specific way.

What to capture, at the moment you encounter it:

- the config file **before** you fix it (`cp settings.json fixtures/`)
- the corrupt state file, the half-written cache, the stale lockfile
- the actual API response that broke the parser, not a hand-written one
- the log excerpt from the real outage

Two rules make the corpus usable rather than a liability:

1. **Capture before repairing.** The instinct is to fix and move on; the
   artifact is gone thirty seconds later. A `cp` costs nothing and is the only
   moment it is available.
2. **Scrub, don't synthesize.** Replace secrets and personal paths, keep the
   *structure* exactly — including the parts that look like noise. The
   irregularity you would tidy away is often the thing that breaks the parser.

Then, for any new diagnostic: green unit tests are the entry ticket, and one
run against a real captured instance is the actual proof. If no real instance
exists yet, say so explicitly rather than treating synthetic coverage as
equivalent — "no real fixture yet" is a known gap; silent equivalence is not.

**Why the real run finds what the suite cannot.** A unit test asks *"does this
function do what I think?"*. The real artifact asks *"is what I think true?"*.
Only the second can fail in a way that surprises the author, and a checker's
whole value lies in surviving exactly those surprises — it is built for the
situation nobody anticipated. That is also why the run has to happen against the
**artifact** rather than a description of it: reading the config file beats
recalling what it contains, and running the packed artifact from a clean
directory beats trusting that the build is fine.

## Verification

For any diagnostic before you trust it:

```bash
# 1. Does it fire on the real captured instance?
HOME=/path/to/captured-home ./the-check    # must FIND the known problem

# 2. Is it quiet on the real healthy state?
./the-check                                 # must be silent, no false positive

# 3. Is the advice actionable — does following it change anything?
#    Run the remedy it prints, then re-run the check.
```

Step 3 is the one that gets skipped and the one that caught the no-op remedy
above. A finding with an inert remedy is worse than no finding: it costs trust
the next time the tool speaks.

## Related

Same family — "it passed, but not against the real thing" — from different angles:

- [[lsn_local_build_false_confidence_prod_flags]] — a local build that is green
  while the production build path is not; reproduce the exact prod invocation.
- [[lsn_verify_cli_side_effects_second_source]] — a command's success text is not
  the side effect; check the side effect from a second source.
- [[lsn_verify_deploy_actually_shipped]] — the deploy reported success; verify
  the deployed artifact answers.
- [[lsn_release_smoke_public_contract_shift_left]] — a smoke test asserting an
  internal detail instead of the public contract, in a job that rarely runs.

The distinction here: those verify a *result* against reality. This one verifies
a *checker* against reality — including the case where the checker is right about
the state and wrong about what to do next.

Agent retrieval when about to trust a freshly written checker:

```
search_lessons({ query: "diagnostic green unit tests wrong against real artifact fixture", tags: ["testing", "verification"] })
```

## When this does not apply

- **The diagnostic's input is fully specified and small** — a semver comparator,
  a pure parser for a formally defined grammar. There is no gap between
  synthetic and real, because the format admits no surprises.
- **No real instance exists yet** (a brand-new failure class you are getting
  ahead of). Then synthetic is all there is — record that as a known gap, and
  capture the first real occurrence when it arrives.
- **Capturing would mean storing secrets you cannot scrub.** A fixture that
  leaks credentials is a worse problem than the one it prevents. Prefer a
  structural reduction, and say in the test what was removed.
