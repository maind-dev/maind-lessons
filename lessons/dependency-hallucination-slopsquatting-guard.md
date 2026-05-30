---
id: lsn_dependency_hallucination_slopsquatting_guard
title: Dependency hallucination guard — verify package existence and trust before installation
type: workflow_best_practice
tier: community
lesson_class: general
quality_tier: hand-vetted
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  languages:
    - javascript
    - typescript
    - python
  platforms: []
  tags:
    - dependencies
    - supply-chain
    - slopsquatting
    - package-management
    - security
summary: >-
  When an AI agent proposes a new dependency, treat the package name as
  untrusted until verified. Hallucinated names and typo variants can be
  weaponized (slopsquatting/dependency confusion). Apply a five-step
  pre-install gate: existence, maintainer provenance, popularity,
  license-policy fit, and known-vulnerability check.
last_validated_at: "2026-05-23"
upvotes: 0
---

## Problem pattern

An agent suggests a package that "looks right". The team installs it
without checks. Later they discover the package was non-existent,
newly-created by an attacker, typo-squatted, or abandoned with weak
maintainer controls.

The failure mode is amplified in agentic workflows: suggestion speed
increases faster than review discipline.

## The pre-install gate (must pass all)

Before adding any new dependency suggested by an agent:

1. **Existence check**
   - Confirm package actually exists in the canonical registry.
2. **Provenance check**
   - Confirm trusted publisher/maintainer and repository linkage.
3. **Adoption check**
   - Prefer broadly-used packages over obscure fresh uploads when both
     solve the same need.
4. **License check**
   - Apply project license policy (for maind stacks see
     `lsn_license_compliance_three_tier`).
5. **Security check**
   - Run advisory/audit scan before merge.

If any check fails, do not install. Use standard-library code or a
better-known alternative.

## Negative tests to include in review

- **Hallucinated package name**: agent proposes `react-super-formx`;
  registry lookup fails. Expected outcome: reject.
- **Typosquat variant**: agent proposes `reqeusts` (looks like
  `requests`). Expected outcome: reject and pin canonical package.
- **Mismatched maintainer signal**: package exists but has no trustworthy
  lineage and minimal adoption. Expected outcome: reject or escalate for
  explicit risk acceptance.

## What to do instead

Use this conversational pattern:

```text
Proposed dependency: <name>
- Exists in canonical registry: yes/no
- Maintainer/repo provenance verified: yes/no
- Adoption signal acceptable: yes/no
- License policy check passed: yes/no
- Security advisory check passed: yes/no
Decision: install / reject / choose alternative
```

This forces explicit evidence before dependency changes land.

## Boundary

This lesson does not ban new dependencies. It bans **unverified**
dependencies.

If your project already has stronger supply-chain controls (allowlists,
internal mirrors, signed provenance, org-level policy checks), follow
those controls as the source of truth.
