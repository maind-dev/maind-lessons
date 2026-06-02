---
id: lsn_fly_depot_build_secret_not_forwarded
title: "Diagnose empty private git clone (curated=0) in fly deploy — Depot builder doesn't forward --build-secret"
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools: []
  languages: [bash]
  platforms: [docker, fly]
  tags: [fly, depot, build-secret, buildkit, deploy]
summary: "`fly deploy` uses Depot as the remote builder by default (`==> Building image with Depot`). flyctl's `--build-secret` is NOT forwarded to Depot, so a build-time `RUN --mount=type=secret` gets no secret. A clone that needs the secret (SSH/private) silently yields nothing while a no-secret clone (HTTPS/public) succeeds — an asymmetric symptom like `community>0, curated=0`. Build locally with `docker build --secret` then `fly deploy --image`."
last_validated_at: "2026-06-01"
---

## Symptom

A Dockerfile that clones two repos at build time (one HTTPS-public, one SSH-private via a deploy key mounted as a build secret) fails a sanity check with an **asymmetric** result:

```
[external-content] community=75 curated=0
FATAL: /external/curated empty — private clone (SSH) silently failed
```

The public HTTPS clone worked; the private SSH clone produced nothing — even though the deploy key is valid (`git ls-remote` with it works locally) and you passed `--build-secret id=ssh_key,src=...`.

## Why

`fly deploy` defaults to the **Depot** remote builder (`==> Building image with Depot`). flyctl's `--build-secret` flag means "secrets for the *remote builder*", but it is **not propagated to Depot** — so inside the build, `RUN --mount=type=secret,id=ssh_key,...` mounts an empty/absent file. `--mount=type=secret` is not `required` by default, so `git fetch` over SSH just fails and a trailing `|| true` in the clone chain swallows the exit code. The no-secret HTTPS clone is unaffected, which is why only the secret-dependent half comes back empty.

## Fix

Build **locally** (where BuildKit demonstrably forwards the secret), push, and deploy by image — bypassing Depot:

```bash
fly auth docker
TAG=registry.fly.io/<app>:$(git rev-parse --short HEAD)
docker build --platform linux/amd64 --provenance=false \
  -f path/to/Dockerfile \
  --secret id=ssh_key,src=$HOME/.ssh/deploy_key \
  -t "$TAG" .
docker push "$TAG"
fly deploy --app <app> --image "$TAG"
```

Harden the Dockerfile too: `--mount=type=secret,id=ssh_key,required=true` turns a missing secret into a loud, immediate failure instead of an empty clone 30s later.

## When this does NOT apply

- **No build-time secret** (all clones public / content baked into the context) — Depot is fine.
- **Local `docker build` / CI runners that forward `--secret`** — the secret arrives; this is specifically the flyctl-to-Depot hand-off gap.
- A separate, later failure mode is auth on the *machines* API after a successful push (`unauthorized` on lease/smoke) — that is a token-scope issue, not the build-secret gap.

```
search_lessons({ query: "fly deploy build secret private clone empty depot", platforms: ["fly"] })
```
