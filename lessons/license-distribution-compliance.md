---
id: lsn_license_distribution_compliance
title: When you distribute, propagate upstream license obligations — auto-publish attribution from the lockfile
type: workflow_best_practice
tier: community
summary: Distribution events (publish, deploy, container push, app store, public binary, SaaS-endpoint) propagate upstream license obligations to your product. Build a stack-agnostic attribution pipeline from the lockfile so the obligation is met automatically — manual NOTICE files drift silently.
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: []
  tags:
    - licensing
    - compliance
    - distribution
    - attribution
    - notice-file
last_validated_at: "2026-05-21"
---

## When this triggers (and when it doesn't)

Any "distribution" event propagates upstream license obligations:

- `npm publish` / `cargo publish` / `pip publish` / `gem push`
- Container push to a public or customer-accessible registry
- Mobile App Store submission (iOS, Android)
- Public website deploy (static + SSR both count — bundled code ships)
- Public binary release (GitHub Releases, Homebrew, packager builds)
- SaaS endpoint exposure (AGPL-relevant — network use is distribution)

**When this does NOT apply:**

- Pure internal tooling never distributed beyond the org (LGPL/GPL still
  intra-org-OK; AGPL still NOT, because internal SaaS users count).
- Private CI scripts and dev-only utilities.
- Repositories under embargo or pre-public access (obligation activates
  on the first distribution event, not earlier).

Pre-Check before adding the dependency is a separate concern — see
[[lsn_license_compliance_three_tier]].

## Obligation matrix per license class

| Class | What you owe at distribution |
|---|---|
| MIT / ISC / 0BSD / Unlicense / CC0 | License text + copyright notice bundled or linked. |
| BSD-2 / BSD-3 | License text + copyright + (BSD-3) no-endorsement clause. |
| Apache-2.0 | License text + copyright + **propagated NOTICE file** from upstream + CHANGES summary on modifications + patent grant passes through. |
| MPL-2.0 | File-level reciprocal — modified MPL files' sources must be available; your own code stays proprietary. |
| LGPL-2.1 / LGPL-3.0 | Dynamic-link OK with no source-disclosure on your code; **static-link triggers full source-disclosure** of code linked against it. |
| GPL-2.0 / GPL-3.0 | Source-disclosure for the combined work; copyleft propagates to anything linked. |
| AGPL-3.0 | Same as GPL **plus network-use counts** — SaaS users must be offered the source. |

## Stack-agnostic auto-publish pipeline

The pattern is identical across ecosystems: parse the lockfile, emit a
versionable attribution artifact, ship it.

| Stack | List command | Output target |
|---|---|---|
| npm / pnpm / yarn | `pnpm licenses list --json` | `<public-dir>/licenses.json` or `NOTICE` |
| cargo | `cargo about generate about.hbs` | `LICENSES-THIRD-PARTY.html` |
| pip | `pip-licenses --format=json` | `THIRD_PARTY_LICENSES.json` |
| go | `go-licenses report ./...` | `THIRD_PARTY_NOTICES.md` |
| maven | `license-maven-plugin:aggregate-add-third-party` | `THIRD-PARTY.txt` |

Build-hook integration (Node example, transferable):

```json
{
  "scripts": {
    "prebuild": "node scripts/generate-attribution.mjs",
    "licenses:check": "node scripts/check-licenses.mjs"
  }
}
```

Single-source-of-truth: ONE attribution file per monorepo, not one per
app. Apps link to a shared `/licenses` page or bundle the same JSON.
Per-app pages drift the moment one app gets a re-generation and another
doesn't.

## Pre-deploy verification snippet

A minimal CI gate that fails when the attribution artifact is stale:

```bash
# Fails if lockfile changed after attribution was last regenerated.
if [ "$(stat -f %m package-lock.json 2>/dev/null || stat -c %Y package-lock.json)" \
   -gt "$(stat -f %m public/licenses.json 2>/dev/null || stat -c %Y public/licenses.json)" ]; then
  echo "ERROR: package-lock.json newer than public/licenses.json — re-run pnpm prebuild."
  exit 1
fi
```

Place this in the deploy pipeline (Vercel / Fly / GitHub Actions),
NOT only in pre-commit — pre-commit catches dev-machine drift, deploy
catches CI-only dependency changes (e.g., Dependabot auto-merge).

## Anti-patterns

- Per-app attribution pages in a monorepo — drift, contradictory lists.
- Manually maintained NOTICE — silently outdated after the next install.
- Static-linking LGPL code without source-offer — common in Go/Rust/C++
  binaries, easy to miss.
- License-text reduced to the SPDX identifier string (`"MIT"`) — the
  obligation is the **full plain text**, not the slug.
- "We'll generate it at release time" — release time is the worst time
  to discover a strong-copyleft contamination; the gate is too late.

## Sample maind tool calls

```
# Before publishing, verify the project's three license layers:
search_lessons({
  query: "license dependency distribution attribution",
  limit: 5
})

# When auditing an unfamiliar repo's distribution-readiness:
audit_repo_aireadiness({ repo_snapshot: { ... } })
# Look for missing LICENSE / NOTICE / attribution checks.
```

Cross-refs: [[lsn_license_compliance_three_tier]] (dependency-add pre-check),
[[lsn_project_license_choice]] (your own LICENSE), [[conv_license_compliance]]
(always-on convention).
