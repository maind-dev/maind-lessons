---
id: lsn_local_build_false_confidence_prod_flags
title: "Reproduce the production build invocation locally — a default local build skips prod-only flags, stages, and arch"
type: workflow_best_practice
tier: community
lesson_class: general
context:
  tools: []
  languages: [bash]
  platforms: [docker]
  tags: [deploy, ci, verification, build-args, docker]
summary: "A green local build is false confidence when production builds differently. Conditional Dockerfile stages gated by a build-arg, a remote builder, a different target arch, or secret mounts mean the production-only code paths NEVER execute in your default local build. Validate by reproducing the exact production invocation — same build-args, --secret, --platform, and builder — or you only tested the half that is identical."
last_validated_at: "2026-06-01"
---

## The trap

You build the image locally, it's green, `/health` is fine — then the production deploy fails in a stage your local build never ran. Common shape: a Dockerfile has a stage gated by a build-arg:

```dockerfile
RUN if [ "$SOURCE" = "external" ]; then \
      apt-get install ... && git clone https://... && git clone git@... ; \
    fi
```

Your default local build uses `SOURCE=monorepo`, so the whole `external` branch is a no-op. The cert/secret/clone bugs in it only surface when production passes `--build-arg SOURCE=external`.

## Why local and prod diverge

The code paths that *don't* run locally are exactly the ones that break in prod:

- **Build-arg-gated stages** (Phase-A vs Phase-B content, feature toggles).
- **Secret mounts** (`--secret`/`--build-secret`) — absent locally, so SSH/private steps are skipped.
- **A different builder** (local BuildKit vs a remote builder that handles secrets/cache differently).
- **A different target arch** (`--platform linux/amd64` on an arm64 dev machine pulls different native binaries).
- **Base-image differences** between what you test and what ships.

## Fix

Reproduce the **production build invocation**, not the convenient default:

```bash
docker build --platform linux/amd64 \
  --build-arg SOURCE=external \
  --secret id=ssh_key,src=$HOME/.ssh/deploy_key \
  -f path/to/Dockerfile -t img:verify .
```

Then run it and check the artifact, not just "build exited 0". Best: a CI job that builds with the exact prod flags on every change, so the prod-only paths are exercised before a deploy.

## When this does NOT apply

- **Local and prod builds are byte-identical** (same single-stage Dockerfile, no build-args, no secrets, same arch) — the default local build is a faithful proxy.
- **Buildpacks / managed builders** where you don't control the Dockerfile — reproduce via the platform's preview/CI build instead.

```
search_lessons({ query: "local docker build passes production deploy fails build-arg stage", platforms: ["docker"] })
```
