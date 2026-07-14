---
id: lsn_npm_oidc_trusted_publishing_migration
title: "E404 Not Found on PUT during npm trusted publishing — auth-chain diagnosis ladder + OIDC migration checklist"
type: debugging_lesson
tier: community
summary: "npm trusted publishing (OIDC) fails with a misleading `E404 Not Found - PUT` when the auth chain is broken. The most invisible cause: the npm-side Trusted Publisher form was never saved — the passkey prompt feels like completion but is only the re-auth BEFORE saving. Migration itself needs npm >= 11.5.1 (Node 22 bundles 10.x), `id-token: write`, and care with pnpm and private repos."
context:
  tools: [claude-code, cursor, windsurf]
  languages: [javascript, typescript]
  platforms: []
  tags: [npm, oidc, trusted-publishing, github-actions, ci, publish]
provenance:
  source: memory
  source_id: 4f818fb7-725e-4c21-9ac8-6d1c4b6f8040
  migrated_at: "2026-07-13"
---

## When this triggers (and when it doesn't)

- Migrating a GitHub-Actions npm publish from a token (`NODE_AUTH_TOKEN` /
  automation token) to OIDC trusted publishing — npm's granular tokens now
  expire after <= 90 days, so token-based CI publishes have a built-in
  time bomb.
- A trusted-publishing publish fails with `npm error code E404` /
  `404 Not Found - PUT https://registry.npmjs.org/<pkg>` even though the
  package clearly exists.

**When this does NOT apply:**

- Publishing from CI systems npm does not support for trusted publishing
  (only GitHub Actions and GitLab CI/CD as of 2026).
- Local publishes from a developer machine — OIDC is CI-only; use a
  short-lived token there.

## The E404 is an auth error, not a missing package

npm masks a rejected OIDC publish as `404 Not Found` on the PUT. Diagnose
in this order (cheapest and most-often-guilty first):

1. **The Trusted Publisher connection was never saved.** The npmjs.com
   form (package → Settings → Trusted Publisher) asks for a passkey /
   security key during setup — that prompt is only the re-authentication
   BEFORE saving, not the save itself. If you stop after the passkey, the
   connection silently does not exist. Detection: the Settings page still
   shows the fillable form with a "Set up connection" button instead of a
   summary of the connected publisher. Fix: click "Set up connection",
   then re-run the failed workflow (`gh run rerun <id> --failed`).
2. **Workflow filename mismatch.** The npm form wants the bare filename
   (`publish.yml`), not `.github/workflows/publish.yml`. Owner/repo must
   be the repo actually executing the workflow (not a fork/mirror).
3. **Environment mismatch.** If the npm form names a GitHub environment,
   the job must declare `environment:` — leave the npm field empty when
   the workflow uses none.
4. **npm too old.** OIDC needs npm >= 11.5.1; Node 22 bundles npm 10.x,
   so `setup-node` with `node-version: 22` silently cannot do OIDC.
5. **Missing `id-token: write`** on the job/workflow permissions.

## Migration checklist (GitHub Actions)

```yaml
jobs:
  publish:
    permissions:
      id-token: write   # OIDC token exchange with the npm registry
      contents: write   # only if the job also creates a GitHub Release
    steps:
      # ... checkout/build/test ...
      - run: npm install -g npm@11   # Node 22 bundles npm 10.x; pin the major
      - run: npm publish --access public
        env:
          NPM_CONFIG_PROVENANCE: "false"  # only for PRIVATE source repos, see below
```

- **Prefer `npm publish` over `pnpm publish`** for the publish step, even
  in a pnpm monorepo: pnpm's OIDC support has a regression history
  (pnpm/pnpm#11513 — 404s on pnpm 11 where pnpm 10 worked), and
  `pnpm/action-setup` with a major-only `version:` floats across minors.
  A pinned npm 11 is deterministic.
- `npm publish` in a pnpm workspace is only safe when **no `workspace:`
  deps sit in runtime `dependencies`** — npm does not rewrite the
  `workspace:*` protocol (pnpm does). devDependencies with `workspace:*`
  are harmless (consumers never install them); bundle workspace sources
  (esbuild) or publish the packages first otherwise.
- `registry-url: 'https://registry.npmjs.org'` in `setup-node` can stay —
  the official npm docs keep it and OIDC works with it (field-verified).
- **Private source repo → no provenance.** npm has rejected provenance
  from private repos since 2023-07, even for public packages. Set
  `NPM_CONFIG_PROVENANCE=false` explicitly so the publish is
  deterministic instead of relying on auto-detection.
- Delete the old npm token/secret only after the OIDC publish is verified
  end-to-end AND no other workflow still references the secret (grep
  `.github/workflows/` first — a sibling package's publish may share it).

## Verification snippet

```bash
# after the tagged run goes green:
npm view <pkg> version dist-tags     # new version must be dist-tags.latest
gh release view <tag> --json isDraft # release object exists (contents: write)
```

## Anti-patterns

- Treating the E404 as "package not found" and debugging the package
  name/scope instead of the auth chain.
- Trusting the passkey prompt as proof the npm-side config was saved.
- `npm install -g npm@latest` — works today, but an unpinned major means
  a future npm 12 can change publish semantics under you; pin `npm@11`.
- Keeping `--provenance` on a private repo "because the docs say it's
  automatic" — the restriction is repo visibility, not a flag.

## Sample maind tool calls

```
# Before migrating a publish workflow to OIDC:
search_lessons({
  query: "npm OIDC trusted publishing E404 publish",
  limit: 5
})
```

Cross-refs: [[lsn_npx_published_source_needs_version_bump]] (the
source-changed-but-never-republished failure mode on the same release
pipeline).
