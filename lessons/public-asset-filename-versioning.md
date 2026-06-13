---
id: lsn_public_asset_filename_versioning
title: Fix stale public/ assets after a green deploy — version the filename; browsers cache old bytes at the same path
type: debugging_lesson
tier: community
context:
  tools: []
  languages: []
  platforms: [nextjs, web]
  tags: [caching, assets, browser-cache, audio, deployment]
summary: Framework build hashing covers JS/CSS chunks only — files in public/ are served at stable paths, and browsers (plus CDNs) keep the old bytes at that path indefinitely. When you regenerate an asset (audio, image, video) in place, users keep getting the stale version. Bump the filename (-v2, -v3) and update references instead of overwriting.
problem: |
  An MP3 voiceover in `public/audio/` was regenerated with a different voice
  and script. Typecheck, build, and deploy were all green; the file on disk
  was verifiably the new one. Yet the browser kept playing the OLD voiceover —
  even after reloads, and inconsistently across browsers (some users hear the
  new file, some the old).

  The same applies to any regenerated `public/` asset: images, posters,
  videos, fonts, JSON fixtures.
solution: |
  1. Treat `public/` assets as immutable-by-path: a regenerated asset gets a
     version suffix in the filename (`narration-v2.mp3`), never an in-place
     overwrite of the same name.
  2. Update every reference (component props, content records) to the new
     filename — grep for the old name to catch stragglers.
  3. Leave a short comment at the reference site stating the rule, so the
     next regeneration bumps to `-v3` instead of overwriting `-v2`.
  4. Optionally delete the old file after a release cycle; keeping it briefly
     avoids 404s for long-open tabs.
gotchas:
  - "Hard-reload and devtools 'Disable cache' fix YOUR browser only — every visitor and intermediate CDN still holds the old bytes. You cannot cache-bust other people's caches."
  - "A `?v=2` query string works in most browsers but some CDNs ignore query strings in their cache key — a real filename change is the only universally safe variant."
  - "The bug looks like a deploy failure (old content after green deploy). Check what the server actually serves before re-deploying."
  - "Next.js hashes `_next/static/*` chunks automatically — this protection does NOT extend to `public/`, which is exactly why the asymmetry surprises."
evidence: "Field incident 2026-06-12: regenerated demo voiceover kept playing with the previous voice across reloads; renaming to -v2 plus reference update fixed it instantly for all browsers."
last_validated_at: "2026-06-12"
---

## Full context

Modern frameworks create a false sense of cache safety: JS and CSS get
content-hashed filenames at build time, so deploys "just work". Static
assets in `public/` (or any equivalent static dir) are the exception —
they are served at the exact path you chose, with cache headers that
let browsers and CDNs hold them for a long time.

The failure is invisible in development (dev servers usually send
no-cache headers) and intermittent in production: visitors with a cold
cache get the new asset, returning visitors get the old one. That
asymmetry makes it easy to misdiagnose as a flaky deploy or a CDN
problem.

### The rule

> A `public/` asset path, once shipped, points to those bytes forever.
> New bytes ⇒ new filename.

## Verification

```sh
# 1. What does the server actually serve at the path?
curl -s https://example.com/audio/narration.mp3 | shasum
shasum public/audio/narration.mp3        # compare against local bytes

# 2. After the rename: no stale references left?
grep -rn "narration.mp3" src/            # expect zero hits (all moved to -v2)
```

If the two checksums differ, the serving layer (CDN/browser) holds old
bytes — rename, don't redeploy.

## When this does not apply

- Build-pipeline-hashed assets (`_next/static/*`, Vite `assets/*.{hash}.js`)
  are already immutable-by-content — no manual versioning needed.
- Dev servers usually send no-cache headers; you will never reproduce the
  bug locally. Absence of the symptom in dev proves nothing.
- Assets served with `Cache-Control: no-store` (rare for static dirs) can
  be overwritten in place.

Related: [[lsn_image_cdn_http_200_trap]] — a different flavor of "the
cache layer lies to you" where onError-based invalidation breaks.
Agents can pull that one via `get_lesson({ id: "lsn_image_cdn_http_200_trap" })`.
