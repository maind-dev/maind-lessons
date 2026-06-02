---
id: lsn_docker_runner_stage_build_script_copy
title: "Fix MODULE_NOT_FOUND for a build-time script run in a multi-stage Docker runner — COPY the script in explicitly"
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools: []
  languages: [javascript, bash]
  platforms: [docker]
  tags: [docker, multi-stage-build, copy]
summary: "Slim multi-stage Dockerfiles copy only the compiled output (build/, dist/) + data from the build stage into the runner. If you add a RUN that executes a source script (e.g. a build-time asset/index-generation step) in the runner stage, that script file is not present → 'Cannot find module .../script.mjs'. COPY the script (and any non-bundled deps it imports) into the runner before the RUN, or move the step to the build stage."
last_validated_at: "2026-06-01"
---

## Symptom

You add a build-time generation step to the **runner** stage of a multi-stage Dockerfile:

```dockerfile
WORKDIR /repo/apps/server
RUN node scripts/generate-assets.mjs
```

and the build fails:

```
Error: Cannot find module '/repo/apps/server/scripts/generate-assets.mjs'
code: 'MODULE_NOT_FOUND'
```

even though the script exists and runs locally.

## Why

The runner stage starts from a fresh base and only gets what you explicitly `COPY`. A typical slim runner copies the **compiled output** and runtime data:

```dockerfile
COPY --from=build /repo/apps/server/build /repo/apps/server/build
COPY --from=build /repo/apps/server/data  /repo/apps/server/data
```

`scripts/` is never copied — it was only needed in the build stage. So a runner-stage `RUN node scripts/...` references a file that isn't in the image.

## Why run it in the runner at all?

Sometimes the step *must* run there: it depends on content that is only assembled in the runner (e.g. files overlaid from another stage after the build). Running it in the build stage would operate on the wrong inputs. In that case the fix is not "move it" but "bring the script in".

## Fix

COPY the script (and any source-only modules it imports) into the runner before the RUN:

```dockerfile
COPY --from=build /repo/apps/server/scripts/generate-assets.mjs \
                  /repo/apps/server/scripts/generate-assets.mjs
RUN node scripts/generate-assets.mjs
```

Ensure its runtime imports resolve too: bundled workspace packages need their `build/` copied (see the related workspace-dep pattern), and third-party imports must be in the prod `node_modules` the runner already has.

## When this does NOT apply

- **The step can run in the build stage** on the same inputs — do that instead; the build stage has the full source tree.
- **The script is bundled into the compiled output** (your bundler emits it into `build/`) — then it's already copied.
- **Single-stage Dockerfiles** — the whole context is present; nothing to copy.

```
search_lessons({ query: "docker multi-stage runner cannot find module script", platforms: ["docker"] })
```
