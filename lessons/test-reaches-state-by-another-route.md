---
id: lsn_test_reaches_state_by_another_route
title: "Seed test state through the path production uses — another route makes the test green about code nobody ships"
type: workflow_best_practice
tier: community
summary: "A test can be about the right subject and still exercise the wrong path to it: seeding rows with a direct INSERT instead of the write RPC, unit-testing a parser while the fetch that feeds it is untested, proving a credential works outside a build that never received it. The suite stays green because the half it covers is the half that still works. One question finds it: if the production path broke right now, would this test fail?"
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  languages: []
  platforms: []
  tags:
    - testing
    - coverage
    - silent-failure
    - regression
    - code-review
last_validated_at: "2026-08-10"
---

## The shape

A feature breaks in production. You go looking for the missing test and find
one — about exactly this feature, passing, and useless. It reached the state it
asserts on by a **different route** than the code that ships.

The suite was never wrong about its subject. It was wrong about the *path*, and
a path is what breaks. This is why the failure survives review: the test file is
named after the thing that is broken.

## The question that finds it

> If the production path broke right now, would this test fail?

Ask it of every test whose setup constructs state. If the honest answer is "no,
the setup would still work", the test is measuring a route nobody takes.

## Three routes that look equivalent and are not

**1. Seeding around the writer.** Tests for a dependency graph inserted their
edges with direct `INSERT` statements and asserted the derived reads — blocked
duration, health signals, roll-ups. All correct, all green. Meanwhile a
migration replaced a full unique constraint with a **partial** one (`… WHERE
resolved_at IS NULL`, so a resolved edge may be recreated). The write RPC still
said `ON CONFLICT (from, to)`, which no longer matched any index, and every
single write failed with `42P10` for two weeks. The tests never called the
writer; they only needed rows, and `INSERT` produces rows.

**2. Testing the pure half, shipping the wired half.** A UI section had unit
tests for its response parser — malformed payloads, null cases, formatting. The
effect that fetched the response had none. That effect listed its own state
cache in its dependency array, so every `setState` restarted it; the restart ran
the previous run's cleanup, which flagged the in-flight request as cancelled; the
response was therefore always discarded and the state stayed `loading` forever.
`loading` rendered nothing, so the section could not appear at all — with the
parser at 100 %.

**3. Proving the credential outside the box.** A container build failed to clone
a private repository. `git ls-remote` with the deploy key succeeded from the
shell, which "proved the key works" — and answered a question nobody had asked.
The real question was whether the secret arrived **inside** the build, and an
outside check cannot answer it; the build flag had the wrong shape and defined
the secret under a different name ([[lsn_fly_depot_build_secret_not_forwarded]]).
The general form of this one is [[lsn_local_build_false_confidence_prod_flags]]:
a local run that skips the production-only path proves only the half that is
identical.

Same shape three times: **the check and the failure sat on different sides of a
boundary** — a write path, a wiring layer, a process boundary.

## When a full-path test is impractical, shrink what stays untested

Some paths genuinely resist testing: React effects without a renderer, container
builds, a deploy's credential plumbing. The answer is not to give up on the path
and over-cover the part that is easy. It is to make the untested remainder small
enough to *read*.

Concretely, for the UI case above: move the fetching into a plain function that
takes the transport as a parameter, test it with an injected fake (success,
empty result, HTTP error, malformed body, thrown network error), and leave five
lines of wiring in the effect. Five reviewable lines with one dependency is a
different risk than forty lines nobody can execute.

The same move works elsewhere: extract the SQL a job runs into a callable
function and test that, leaving the scheduler untested; put the request builder
behind a boundary and let the untested part be the actual send.

## When this does NOT apply

- **The test is about the derivation, not the write.** A test that asserts how
  blocked-duration is computed may legitimately seed rows directly — fixtures are
  fine when the subject is the read. What is not fine is *concluding* from it
  that writing works. Keep one test that goes through the writer, so the claim
  and the coverage line up.
- **The path is owned and covered elsewhere.** If a contract test already drives
  the writer, unit tests downstream may seed freely.
- **Throwaway or spike code**, where the cost of the harness exceeds the life of
  the code.
- **The boundary is the thing you are stubbing on purpose** — you are testing
  retry behaviour and want a fake transport. That is a deliberate substitution,
  not an accidental detour; say so in the test name.

## Spotting it in review

Three cheap heuristics, in order of yield:

1. **Compare the imports.** Does the test import the same entry point the
   production caller imports? A test that imports the table/DAO while production
   imports the service is the pattern, visible without reading a line of logic.
2. **Look at the setup, not the assertions.** Assertions are usually right.
   Setup is where the detour hides.
3. **After a schema or contract change, grep for who still calls the writer.**
   The 42P10 case above was a correct migration plus an un-updated caller; the
   guard that would have caught it is a test — or, cheaply, an assertion in the
   migration itself that the calling code still contains the predicate it needs.

Neighbouring failure classes worth knowing: a consumer that ships without its
producer wired into the default path ([[lsn_feature_not_live_until_producer_wired]]),
and a gate that writes into the very tree it inspects
([[lsn_verification_gate_gitignore_own_artifacts]]). All three are "green about
something other than what ships".

Surface the cluster with:

```
search_lessons({ query: "test seeds state directly production path untested", tags: ["testing"] })
```
