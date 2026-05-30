---
id: lsn_fly_monorepo_deploy_from_root
title: Run `flyctl deploy` from the monorepo root when the Dockerfile uses root-relative COPY paths
type: workflow_best_practice
tier: community
lesson_class: architecture
quality_tier: hand-vetted
context:
  tools:
    - flyctl
    - docker
    - pnpm
  languages: []
  platforms:
    - fly.io
  tags:
    - monorepo
    - dockerfile
    - deploy
    - workspace
summary: >-
  In a pnpm/npm/yarn monorepo, the per-app Dockerfile typically uses
  `COPY pnpm-lock.yaml pnpm-workspace.yaml apps/<app>/ …` — paths relative
  to the monorepo root, not the app subdirectory. `flyctl deploy` must
  therefore run with CWD at the monorepo root + explicit `--config` and
  `--dockerfile` flags. Running it from inside the app directory hits a
  cache-key resolution failure on `/apps/<app>`.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The symptom

You ran `flyctl deploy` from inside your app's directory (the natural thing to do — that's where `fly.toml` lives) and got a `failed to compute cache key` error pointing at `/apps/<your-app>` as not-found.

Or you ran `flyctl deploy` from the monorepo root without flags and got a `Dockerfile '<root>/Dockerfile' not found` error.

## What's actually happening

In a monorepo, the per-app `Dockerfile` typically looks like this:

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/my-app/package.json apps/my-app/
COPY packages/ packages/
RUN pnpm install --frozen-lockfile --filter "my-app..."
```

The `COPY` paths are relative to the build context — the directory `docker build` sees as `.`. Monorepo Dockerfiles assume that context is the monorepo root, because they need access to:

- the root `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock`
- the root `pnpm-workspace.yaml`
- sibling `packages/*` workspaces

`flyctl deploy` derives the build context from CWD by default. From inside `apps/my-app/`, the build context is the app directory — and the `COPY pnpm-lock.yaml` step fails because it's not there.

## The fix

```bash
cd /path/to/monorepo
flyctl deploy \
  --config apps/<your-app>/fly.toml \
  --dockerfile apps/<your-app>/Dockerfile \
  -a <your-app-name>
```

- `--config` points at the per-app `fly.toml`.
- `--dockerfile` is also required. `fly.toml` normally says `dockerfile = 'Dockerfile'` — relative to the toml's own location — but `flyctl` resolves that path against the CWD (monorepo root), so it looks for `<root>/Dockerfile` and fails. Explicit `--dockerfile` flag with the full path-from-root fixes that.

To verify quickly, add `--build-only` — that builds the image without releasing. If it completes, the COPY paths are resolving correctly. Drop the flag for the real deploy.

## CI variant

The same rule applies in CI workflows — keep `working-directory` at the repo root and pass the per-app paths via flags:

```yaml
- name: Deploy
  run: |
    flyctl deploy \
      --config apps/my-app/fly.toml \
      --dockerfile apps/my-app/Dockerfile \
      -a my-app
  working-directory: .
```

Setting `working-directory: apps/my-app` reproduces the local bug.

While you're here: if the Dockerfile uses `pnpm install --filter "<app>"`, add the triple-dot suffix (`--filter "<app>..."`) so transitive workspace dependencies are included. Missing dependencies look like the same class of failure but have a different root cause.

## When this does not apply

If your app is in a single-app repository (no `apps/` or `packages/` sibling directories, no workspace lockfile at the root), the Dockerfile-relative-to-app pattern is the natural default and the bug does not occur. `flyctl deploy` from the app directory works fine.

The convention also does not apply to Dockerfiles written defensively as "context-relative" (paths starting with `./`) — those work from any CWD.
