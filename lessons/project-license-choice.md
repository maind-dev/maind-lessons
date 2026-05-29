---
id: lsn_project_license_choice
title: Pick your project's LICENSE explicitly at git-init — absence defaults to maximum restriction
type: workflow_best_practice
tier: curated
summary: A project without an explicit LICENSE file defaults to "all rights reserved" — the most restrictive position. At git-init, walk a short decision tree and commit a real LICENSE file with an SPDX identifier. Late-stage license changes require consent from every existing contributor.
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: []
  tags:
    - licensing
    - project-setup
    - spdx
    - cla
    - new-repo
last_validated_at: "2026-05-21"
---

## When this triggers (and when it doesn't)

Triggers at:

- `git init` / `npm init` / `cargo init` / `python -m build` for any
  codebase intended to outlive a single afternoon.
- Adoption of a legacy repository that has no LICENSE file.
- Repository-promotion from private to public — the moment of public
  visibility is the moment the default-restriction becomes harmful.

**When this does NOT apply:**

- Forks — the upstream LICENSE travels with the code; you don't get to
  pick. (Modifying it requires upstream-author consent.)
- Throwaway prototypes with a planned lifetime ≤ 2 weeks.
- Internal-only packages inside a monorepo — the monorepo's root LICENSE
  governs.
- Public mirrors of internal repos where the LICENSE must be *stricter*
  than the internal one (here the decision is "don't relax", not "pick").

## Decision tree

| Want | Pick |
|---|---|
| Open-source, maximum reach | MIT or Apache-2.0 |
| Open-source + explicit patent grant | Apache-2.0 |
| Open-source + viral copyleft (force downstream to share) | GPL-3.0 |
| Open-source + viral copyleft + network use counts (SaaS) | AGPL-3.0 |
| Source-available, commercial-protect | BSL / Elastic License v2 / FSL / FCL |
| Proprietary, internal | "All Rights Reserved" + an EULA if you distribute |
| Dual-license (community + commercial) | GPL/AGPL + commercial side-agreement |

The default for a new generic open-source project is MIT. Apache-2.0
when you want patent protection or formal corporate friendliness.
Copyleft only when you have a specific reason to require downstream
reciprocity — most contributors are scared off by AGPL.

## Required artifacts per choice

1. **`LICENSE` file in repo root** — full plain text, not just the
   SPDX identifier slug. Tools (GitHub, npm, IDE plugins) detect the
   license by parsing this file's contents.
2. **SPDX identifier in your manifest:**
   - `package.json`: `"license": "MIT"`
   - `Cargo.toml`: `license = "Apache-2.0"`
   - `pyproject.toml`: `license = { text = "MIT" }`
   - `composer.json`: `"license": "BSD-3-Clause"`
3. **Optional per-file headers** — Apache-2.0 recommends them, GPL
   commonly includes them. MIT typically does not.
4. **`CONTRIBUTING.md` with a license-note** — declare either
   "Inbound = Outbound" (contributions licensed under the project's
   LICENSE automatically) or a CLA requirement with a link.

## CLA threshold

A Contributor License Agreement adds friction but protects against
relicensing-blockers later:

- **< 5 contributors**: Inbound = Outbound is usually enough.
  Add a one-line note in CONTRIBUTING.md.
- **≥ 5 contributors OR corporate-backed**: consider a CLA.
  DCO (Developer Certificate of Origin) is the lighter alternative —
  each commit signed off with `Signed-off-by:` and a clickwrap CLA
  on the repo platform.
- **Foundation-hosted projects**: the foundation's CLA applies, no
  per-project decision needed.

## Anti-patterns

- **No LICENSE file at all** — default position is "all rights reserved",
  the most restrictive. Even friendly Side-Projects hit this trap.
- **License mentioned in README but no LICENSE file** — GitHub, npm, and
  IDE plugins read the file, not the README. Detection fails silently.
- **Late-stage LICENSE change** with existing external contributors —
  requires explicit re-licensing consent from each. Often practically
  impossible after the first ~10 contributors.
- **"Custom LICENSE" assembled from clauses** — legally ambiguous,
  scares off contributors, fails automated license-classification.
- **Treating LICENSE choice as reversible** — it is, but cost climbs
  super-linearly with contributor count.

## Sample maind tool calls

```
# At project setup, walk the decision tree:
search_lessons({
  query: "project license choice MIT Apache GPL decision",
  limit: 5
})

# After choosing, verify the distribution-side obligations:
get_lesson({ id: "lsn_license_distribution_compliance" })
```

Cross-refs: [[lsn_license_compliance_three_tier]] (dependency-add pre-check),
[[lsn_license_distribution_compliance]] (distribution obligations),
[[conv_license_compliance]] (always-on convention).
