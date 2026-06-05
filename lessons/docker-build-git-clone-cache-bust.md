---
id: lsn_docker_build_git_clone_cache_bust
title: "Diagnose stale Docker build-time Git clones from moving refs — add a cache-bust or SHA ref"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: [docker, flyctl]
  languages: [typescript, javascript]
  platforms: [node, fly.io]
  tags: [docker, buildkit, deployment, git, cache, external-content]
summary: "When a Docker build stage clones external content from a moving ref like `main`, the build can stay green while shipping stale content: Docker reuses the clone layer because the command string and build args did not change. Bust the external-content layer with a timestamp/commit SHA build arg, or pass immutable Git SHAs instead of branch names, then verify shipped counts from the live health endpoint."
problem: |
  A production image clones content from Git during `docker build`:

  ```dockerfile
  ARG CONTENT_REF=main
  RUN git fetch --depth 1 origin "$CONTENT_REF" && \
      git checkout -q FETCH_HEAD && \
      cp -R content/. /app/content/
  ```

  A new content commit lands on `main`. You redeploy. The Docker build,
  image push, rollout, and health check all succeed. But the live service
  still reports the old content inventory: for example the dashboard or
  source repo shows 185 items while `/health` reports 166.

  The deceptive part: this is not a failed deploy. It is a successful deploy
  of an image that embedded a stale cached clone layer.
solution: |
  Treat moving Git refs as cache-unsafe build inputs. Use one of these patterns:

  ```bash
  # Preferred when the deploy pipeline can resolve the refs first:
  docker build \
    --build-arg PUBLIC_CONTENT_REF="$PUBLIC_SHA" \
    --build-arg PRIVATE_CONTENT_REF="$PRIVATE_SHA" \
    -t "$IMAGE" .
  ```

  Or add an explicit cache-bust arg for the external-content stage:

  ```dockerfile
  FROM node:20-slim AS external-content
  ARG CONTENT_CACHE_BUST=static
  ARG CONTENT_REF=main

  RUN echo "content cache-bust=$CONTENT_CACHE_BUST" >/dev/null && \
      git fetch --depth 1 origin "$CONTENT_REF" && \
      git checkout -q FETCH_HEAD && \
      cp -R content/. /external/content/
  ```

  ```bash
  docker build \
    --build-arg CONTENT_REF=main \
    --build-arg CONTENT_CACHE_BUST="$(date -u +%Y%m%d%H%M%S)" \
    -t "$IMAGE" .
  ```

  Keep the cache-bust scoped to the external clone layer, not the whole image,
  so dependency layers can still cache.
gotchas:
  - "`LESSONS_SOURCE=external` or a similar mode flag only changes the cache key when its value changes. If it stays `external`, Docker can keep reusing the same cloned `main` layer."
  - "A health check returning 200 only proves the service boots. Add content-specific verification: counts, commit IDs, or a known newly-added item."
  - "BuildKit secret mounts do not include the secret contents in the cache key. Fixing a deploy key does not necessarily invalidate a stale failed clone layer."
  - "If you tag images by the app commit SHA, content-only changes in a separate repo need their own cache key; otherwise the app SHA stays constant while the content changed."
last_validated_at: "2026-06-05"
upvotes: 0
---

## Diagnostic signals

Look for this signature:

```text
external-content clone step: CACHED
image build: success
rollout: success
/live health: old content counts
source repo or dashboard: newer content counts
```

A successful deploy with a lower-than-expected count is the smell. Compare the
count from the live service with the count from the source-of-truth repository,
not just with the build status.

If the build logs include a content-count marker, make it part of the deploy
checklist:

```text
[external-content] community=94 curated=91 templates=8
```

Then verify the live service after rollout:

```bash
curl -s https://example.com/health
# Expect the same content split that the build marker printed.
```

## Why Docker caches this

Docker layer cache is driven by the instruction text, previous layer digest,
and build args that are referenced in the instruction. A branch name like
`main` is just the string `main`; Docker does not know that the remote branch's
HEAD moved. Without a changing build arg or immutable SHA, the clone command is
cache-equivalent to the previous build.

This is especially easy to miss in multi-repo systems where the app repository
has not changed, but a content repository has. The deploy looks like an app
redeploy, yet the actual changing input lives elsewhere.

## Stronger pattern: embed provenance

For long-lived systems, bake the resolved content SHAs into the image and expose
them in `/health`:

```json
{
  "content_loaded": 185,
  "content_refs": {
    "public": "abc1234",
    "private": "def5678"
  }
}
```

Counts catch many mistakes; commit IDs catch the subtle ones where the count did
not change but the content did.

## When this does not apply

This does not matter when the content is copied from the same Docker build
context and the app commit changes with the content. It also does not matter
when you pass immutable Git SHAs and those SHAs change for every content update.

It does apply to public or private Git clones in Dockerfiles, generated docs,
model files, rule bundles, feature-flag manifests, static content, or any other
external artifact fetched during the build from a moving ref.

## Retrieving this convention

```typescript
search_lessons({
  query: "docker build git clone main cached stale external content",
  tools: ["docker"],
  platforms: ["fly.io", "node"],
});
```

Related vetted conventions:

- [[lsn_fly_monorepo_deploy_from_root]] — adjacent Fly/monorepo deployment context.
- [[lsn_verify_cli_side_effects_second_source]] — verify the actual side effect, not only the command's success summary.
