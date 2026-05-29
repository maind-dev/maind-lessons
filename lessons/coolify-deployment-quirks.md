---
id: lsn_coolify_deployment_quirks
title: Five Coolify + Docker Compose quirks — expose vs ports, swallowed npm errors, auto-ARGs, strict package.json
type: workflow_best_practice
tier: community
lesson_class: architecture
quality_tier: hand-vetted
context:
  tools:
    - coolify
    - docker
    - docker-compose
  languages: []
  platforms:
    - coolify
  tags:
    - coolify
    - docker-compose
    - deployment
    - reverse-proxy
summary: >-
  Coolify is a self-hosted PaaS wrapping Docker Compose with Traefik.
  Five non-obvious things bite first-time users: `expose` not `ports`
  (so Traefik can route), `EXPO_PUBLIC_*`/`NEXT_PUBLIC_*` need
  buildtime not runtime, swallowed npm errors (reproduce with
  `docker build --progress=plain`), auto-injected `COOLIFY_*` /
  `SERVICE_URL_*` ARGs, and container `npm` is stricter about
  `package.json` validity than local.
last_validated_at: "2026-05-18"
upvotes: 0
---

## Quirk 1 — `expose` instead of `ports`

In `docker-compose.yaml`, use `expose: [80]`, NOT `ports: "80:80"`.

Coolify runs Traefik as a reverse-proxy in front of every service. With `ports: "80:80"` you bind the container port directly to the host network — bypassing Traefik. The user hits the host on port 80, gets whatever the OS routes there (usually nothing, or 404), and never reaches the Traefik routes Coolify configured for your domain.

With `expose`, the port is reachable only inside the Docker network. Traefik picks it up via labels and routes the user's domain to it properly.

```yaml
services:
  web:
    image: my-app
    expose:
      - "80"      # ✓ Traefik can route to it
    # ports:
    #   - "80:80" # ✗ bypasses Traefik
```

## Quirk 2 — `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` need the buildtime toggle

Coolify env vars are runtime-only by default. Frameworks that inline public env vars into the JS bundle at build time need an explicit "Available at Buildtime ✅" toggle per variable, plus matching `ARG` + `ENV` lines in the Dockerfile.

This is its own dedicated convention with full step-by-step recovery — see related `lsn_coolify_buildtime_toggle_public_envs` for the full fix.

## Quirk 3 — Coolify swallows npm error output

When a build fails, the Coolify deployment log often shows:

```
Step 12/20 : RUN npm run build
exit code: 1
Error: build failed
```

… and no actual npm error. The real error (`EJSONPARSE`, `ERESOLVE`, missing dep) is somewhere upstream in the same `RUN` step but doesn't make it to the Coolify UI.

Reproduce locally with full output:

```bash
docker build --progress=plain --no-cache \
  --build-arg NEXT_PUBLIC_FOO=bar \
  -f apps/web/Dockerfile \
  -t debug-build \
  .
```

`--progress=plain` writes every line; `--no-cache` forces a fresh run so you see the error this build, not a cached pre-error layer.

## Quirk 4 — Coolify auto-injects 10+ ARGs

You don't need to declare these — Coolify passes them as build-args on every build: `COOLIFY_FQDN`, `COOLIFY_URL`, `COOLIFY_BRANCH`, `SERVICE_URL_<NAME>`, `SERVICE_FQDN_<NAME>`, plus more. All prefixed with `COOLIFY_` or `SERVICE_`.

To consume them, declare `ARG COOLIFY_FQDN` in the build stage and they're available. If you tried to "manually pass" them via Coolify's env-vars panel, you might create a conflict — let Coolify do it.

## Quirk 5 — Container `npm` is stricter than local

`package.json` with JSON5-style comments works locally with most editor/Node combinations:

```json5
{
  "name": "my-app",
  // "dependencies": { ... },   // ← works locally, fails in container
  "scripts": { "build": "next build" }
}
```

The container's npm rejects it with `EJSONPARSE`. The Coolify log swallows the message (quirk 3) so the failure is opaque.

Same applies to: `lockfileVersion: 3` requires Node ≥ 22 in the container; older Node images fail dependency resolution with `ERESOLVE`. Match the container's Node major version to your local Node version and validate `package.json` with `python3 -c "import json; json.load(open('package.json'))"` before push.

For a new Coolify service, run this checklist before declaring it ready:

```bash
# 1. expose vs ports
grep -E 'ports:|expose:' docker-compose.yaml

# 2. Each EXPO_PUBLIC_* / NEXT_PUBLIC_* has matching ARG in Dockerfile
grep -E '^(EXPO_PUBLIC|NEXT_PUBLIC|VITE)_' .env.example | while read var; do
  name=${var%%=*}
  grep -q "ARG $name" Dockerfile || echo "missing ARG: $name"
done

# 3. JSON validity
python3 -c "import json; json.load(open('package.json'))"
```

A zero-warning checklist run usually means the deploy will succeed on the first try.

## When this does not apply

These quirks are specific to Coolify + Docker-Compose deployments. They don't apply to direct VPS deploys without Coolify (no Traefik, no auto-ARG injection, you wire ports yourself), or managed platforms like Vercel/Netlify/Cloudflare Pages (different conventions, fewer quirks because the build runs on their infrastructure with their tooling).
