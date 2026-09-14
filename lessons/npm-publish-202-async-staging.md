---
id: lsn_npm_publish_202_async_staging
title: "Diagnose a published npm package the registry does not serve — npm publish is asynchronous and returns 202"
type: debugging_lesson
tier: community
summary: "`npm publish` (npm >= 11) can return HTTP 202 Accepted and exit 0 while the version is only staged — the registry serves the previous version for minutes afterwards. Re-running in that window fails with E409 `Cannot publish over previously staged version`, and `npm stage list` shows nothing, so the release looks both done and undone at once. It completes on its own; the fix is to wait and verify against the packument, not to rebuild or bump."
context:
  tools: ["npm"]
  languages: ["javascript", "typescript"]
  platforms: ["node"]
  tags: ["npm", "publish", "release", "async", "staging", "silent-failure", "verification"]
---

## Symptom

You publish. The command prints the usual notice and exits **0**:

```
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access
$ echo $?
0
```

Minutes later the registry still serves the old version:

```bash
curl -s https://registry.npmjs.org/@scope%2Fpkg | jq -r '.["dist-tags"].latest'
# 0.68.0        ← you just published 0.69.0
```

So you publish again — and now it fails in a way that contradicts the first
observation:

```
npm error code E409
npm error 409 Conflict - PUT https://registry.npmjs.org/@scope%2fpkg
npm error Cannot publish over previously staged version "0.69.0".
```

The version is simultaneously **not published** (registry serves 0.68.0) and
**already taken** (409). And the obvious next probe returns nothing:

```bash
npm stage list @scope/pkg
# No staged versions of package name "@scope/pkg".
```

## Root cause: the publish is asynchronous, and the exit code does not say so

npm's publish is no longer a single synchronous write. The registry answers the
PUT with **202 Accepted** — the tarball is received and the version is reserved,
but it is not yet served. npm's CLI treats 202 as success and exits 0, so every
signal available at the call site says the release is done.

The debug log is the one place the two-phase nature is visible:

```bash
grep "http fetch PUT" ~/.npm/_logs/<timestamp>-debug-0.log
# 44 http fetch PUT 202 https://registry.npmjs.org/@scope%2fpkg 1731ms
```

**201 Created** would mean published. **202 Accepted** means queued. A measured
case on npm 11.16.0: two packages published at 18:57, the registry still served
the previous versions at 18:59 (a direct packument fetch, not `npm view`), and
both were fully available shortly after — no further action taken.

`npm stage list` does not close the gap, because it reports the *explicit*
staging flow (`npm stage publish` / `npm stage approve`). A version parked by an
in-flight ordinary publish is not an entry there. An empty list is therefore not
evidence that nothing is pending.

**Why this is easy to misdiagnose.** Every reading is locally correct and the
composite is misleading: exit 0 says the publish worked; the packument says it
did not; the 409 says somebody already took the version; the empty stage list
says nobody did. The tempting conclusions are all wrong in the same direction —
they assume a *failure* that needs a repair. Chained commands make it worse: with
`pnpm build && npm publish`, a genuinely failed build is indistinguishable at a
glance from this, so "the build must have failed" becomes the natural guess, and
the repair (rebuild, bump, republish) burns a version number for a release that
was already on its way.

## Fix

**Wait and re-measure.** Nothing is broken and nothing needs repeating.

```bash
# Direct packument — never `npm view` here: it reads npm's local cache and can
# report either state depending on when the cache was last filled.
curl -s "https://registry.npmjs.org/@scope%2Fpkg" | jq -r '.["dist-tags"].latest'
```

Confirm with a **second, genuinely independent** probe — fetch the artifact, not
more metadata:

```bash
cd "$(mktemp -d)" && npm pack @scope/pkg@0.69.0
# @scope-pkg-0.69.0.tgz  → the bytes are really served by the CDN
```

Two metadata reads taken a second apart are not two pieces of evidence; they are
one observation of one cache. A packument read plus a tarball download are two.

If the version has genuinely not appeared after a long wait, read the debug log
before acting: a `PUT 202` means it is in flight, and any other status is a real
error with its own message.

**The tail of the same delay: ETARGET on the first install.** Once the registry
serves the new version, a *consuming* machine can still hold a cached packument
that predates it — and the two halves disagree inside a single command:

```
npm install -g @scope/pkg@latest
npm error code ETARGET
npm error notarget No matching version found for @scope/pkg@0.24.0.
```

`@latest` resolved to the new version (fresh dist-tag) while the cached version
list does not contain it. This is not a failed publish; it is a stale index.
Force a fresh read: `npm install -g --prefer-online @scope/pkg@latest`.

**Do not:**

- **Bump the version to escape the 409.** The staged version is the one being
  published; a bump abandons a release that is already landing and leaves a
  phantom number that can never be reused.
- **`npm publish --force`.** It cannot overwrite a staged version, and the flag
  exists for a different problem.
- **Treat `npm view` as the check.** It is cache-backed — the same command
  reported both states within minutes in the measured case.

## Prevention

In a release script, separate the two phases explicitly instead of inferring
success from an exit code:

```bash
npm publish --access public || exit 1

for i in $(seq 1 30); do
  live=$(curl -s "https://registry.npmjs.org/$ENC_NAME" | jq -r '.["dist-tags"].latest')
  [ "$live" = "$VERSION" ] && { echo "published: $VERSION"; exit 0; }
  sleep 20
done
echo "still not served after 10 min — read ~/.npm/_logs for the PUT status" >&2
exit 1
```

The value is not the polling; it is that the script stops claiming a release is
done at the moment npm stops talking about it.

## When this does NOT apply

- **npm < 11 / registries that answer 201.** A synchronous publish is visible
  immediately; a missing version then really is a failure.
- **A genuine build failure ahead of the publish.** `PUT` never appears in the
  log at all — check for it before assuming this convention.
- **The explicit staging flow.** If you ran `npm stage publish`, the version is
  waiting for `npm stage approve <stage-id>` and will *never* appear on its own.
  `npm stage list` shows those; it is the emptiness of that list that separates
  the two cases.
- **E404 on PUT.** That is an authentication failure, not a staging delay —
  see [[lsn_npm_oidc_trusted_publishing_migration]].

## Related

Surface this and its neighbours from a session:

```typescript
search_lessons({
  query: "npm publish exit 0 registry still serves old version staged 409",
  tools: ["npm"],
  tags: ["publish", "verification"],
});
get_lesson({ id: "lsn_verify_cli_side_effects_second_source" });
```

- [[lsn_verify_cli_side_effects_second_source]] — the general rule this is a hard
  instance of: confirm an effect against a source independent of the command that
  claimed it.
- [[lsn_npx_published_source_needs_version_bump]] — the neighbouring "shipped but
  not delivered" failure, where the version was never bumped at all.
- [[lsn_global_cli_install_silently_stale]] — the consumer-side sibling: the
  publish landed and the machine never re-resolved it.
