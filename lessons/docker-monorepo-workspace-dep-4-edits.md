---
id: lsn_docker_monorepo_workspace_dep_4_edits
title: "Diagnose `TS2307: Cannot find module` in Docker multi-stage — pnpm workspace-package dep needs 4 Dockerfile edits"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [docker]
  tags: [pnpm, monorepo, docker, multi-stage-build, workspace-deps, deploy-failure]
summary: "Adding a workspace package as new dep needs 4 Dockerfile edits: build COPY, pnpm-build (topo-order), prod-deps COPY, runner overlay. Local typecheck passes; container build fails TS2307."
gotchas:
  - "Opaque symptom: TS2307 / Cannot find module against a dep that IS in package.json and IS in pnpm-lock.yaml — because Docker only sees what you COPY."
  - "Local `pnpm -r typecheck` passes because pnpm symlinks the whole workspace; Docker's build stage is a fresh context."
  - "Pre-commit typecheck hooks do NOT catch this — they run the same local symlink-resolution as the editor."
  - "Each of the 4 edits fails differently: missing build COPY → install fail, missing build pnpm-build → empty build/, missing prod-deps COPY → fresh-install resolution fail, missing runner overlay → runtime crash."
---

# Diagnose `TS2307: Cannot find module` in Docker multi-stage — pnpm workspace-package dep needs 4 Dockerfile edits

## Symptom and root cause

A `tsc` step inside the Docker `build` stage fails with:

```
src/lib/foo.ts(23,45): error TS2307: Cannot find module '@scope/new-workspace-pkg' or its corresponding type declarations.
```

…even though local `pnpm -r typecheck` is clean, the new dependency is correctly declared in `package.json`, and `pnpm-lock.yaml` resolves it correctly.

pnpm installs create symlinks across the entire workspace:

```
node_modules/@scope/new-workspace-pkg → ../../../packages/new-workspace-pkg
```

Every TypeScript compile sees the full workspace via these symlinks. Pre-commit hooks running `tsc --noEmit` use the same resolution path — they ALL pass. Docker's `build` stage starts in a fresh build context. Only what you explicitly `COPY` is available. If the new dependency's `packages/` directory isn't in that list, pnpm install inside the container cannot resolve the workspace alias, and the consumer's `tsc` breaks with TS2307.

A quick `search_lessons({query: "docker monorepo workspace dependency", platforms: ["docker"]})` surfaces the Vercel/Netlify counterpart (`lsn_pnpm_workspace_prepare_script`) — same root-cause class, different host.

## The 4 Dockerfile edits (in order)

Assume `apps/my-app/` now depends on `packages/new-pkg/`. A typical multi-stage Dockerfile has three stages — `build`, `prod-deps`, `runner`. The new dep needs to land in each:

```dockerfile
# Stage 1: build
FROM base AS build
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/existing-pkg/ ./packages/existing-pkg/
COPY packages/new-pkg/      ./packages/new-pkg/         # edit 1
COPY apps/my-app/           ./apps/my-app/
RUN pnpm install --filter "my-app..." --frozen-lockfile
RUN pnpm --filter @scope/existing-pkg build \
    && pnpm --filter @scope/new-pkg build \             # edit 2 (topo-order)
    && pnpm --filter my-app build

# Stage 2: prod-deps (minimal runtime install)
FROM base AS prod-deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/existing-pkg/package.json ./packages/existing-pkg/
COPY packages/new-pkg/package.json      ./packages/new-pkg/    # edit 3
COPY apps/my-app/package.json ./apps/my-app/
RUN pnpm install --filter "my-app..." --frozen-lockfile --prod --ignore-scripts

# Stage 3: runner (final image)
FROM node:20-alpine AS runner
COPY --from=prod-deps /repo /repo
COPY --from=build /repo/packages/existing-pkg/build /repo/packages/existing-pkg/build
COPY --from=build /repo/packages/new-pkg/build      /repo/packages/new-pkg/build  # edit 4
COPY --from=build /repo/apps/my-app/build           /repo/apps/my-app/build
```

Missing **any** of the 4 = container build or runtime fails. Each location has a distinct symptom:

| Missing edit | Failure mode |
|---|---|
| 1 (build COPY source) | `pnpm install` fails: workspace package not resolvable |
| 2 (build pnpm-build step) | Install succeeds but consumer's `tsc` fails with TS2307, OR runtime crashes with "Cannot find module './build/index.js'" |
| 3 (prod-deps COPY package.json) | Build stage succeeds, prod-deps stage fails to resolve workspace symlink |
| 4 (runner COPY --from=build) | Container starts, crashes at first import: "Cannot find module '/repo/packages/new-pkg/build/index.js'" |

## Verification and prevention

A fresh local Docker build replicates the CI/Fly environment exactly:

```bash
cd <monorepo-root>
docker build --no-cache -f apps/my-app/Dockerfile -t my-app:test .
```

The `--no-cache` matters: without it, BuildKit reuses old layers from before the new dependency was added, and the failure won't reproduce.

For monorepos with multiple deployable apps, a scripted check:

```bash
for dockerfile in apps/*/Dockerfile; do
  app=$(basename "$(dirname "$dockerfile")")
  echo "[verify-docker] $app"
  docker build --no-cache -f "$dockerfile" -t "test:$app" . || exit 1
done
```

A cheaper static check (~1s vs 30-60s container build) parses each Dockerfile against `package.json` workspace deps:

```js
// scripts/verify-dockerfile-coverage.mjs (pseudocode)
for (const target of dockerfileTargets) {
  const declaredWorkspaceDeps = workspaceRuntimeDeps(target);
  const dockerfile = await readFile(target.dockerfile);
  for (const dep of declaredWorkspaceDeps) {
    if (!dockerfile.includes(`packages/${dep.dirName}/`)) {
      throw new Error(`${target.dockerfile} missing COPY for workspace dep: ${dep.name}`);
    }
  }
}
```

Run in CI as a pre-deploy gate alongside the full `docker build --no-cache`. The static check catches the cheap structural cases; the full build catches everything else.

## When this does not apply

- Single-package projects (no workspace deps, no Dockerfile-per-app).
- Workspace packages consumed only at build-time (e.g., a CLI used in a `RUN` step that doesn't end up in the runtime image) — edits 3 and 4 are unnecessary; edits 1 and 2 still required.
- Monorepos without Docker (Vercel, Netlify, Fly's Buildpacks). The framework's auto-detection includes everything in `pnpm-workspace.yaml`; see `lsn_pnpm_workspace_prepare_script` for that variant.
- Frameworks that build single-binary artifacts (Go, Rust). The multi-stage pattern is similar but the specific stage-mapping above is JS-ecosystem-flavored.

## Related vetted conventions

- `lsn_pnpm_workspace_prepare_script` — the Vercel/Netlify counterpart; framework calls build directly, not via Docker multi-stage.
- `lsn_auto_commit_package_json_review` — the inverse case (deps silently removed from package.json, local cache hides it).
- `lsn_typescript_ci_gate_two_layer` — the two-layer pattern that catches this when extended to include `docker build --no-cache` as Layer 3.

## Version history

- v1 (2026-05-29): Initial. Born from a deploy failure where an MCP-server app added a new workspace-package as runtime dep for a feature. Local `pnpm -r typecheck` stayed green, but `flyctl deploy` failed in the Docker `build` stage with `TS2307: Cannot find module`. The fix was exactly the 4-edit pattern. Generalized because every pnpm-monorepo + Docker multi-stage setup is structurally susceptible.