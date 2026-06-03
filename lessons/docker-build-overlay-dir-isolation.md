---
id: lsn_docker_build_overlay_dir_isolation
title: "Isolate app-owned data files from any directory a Docker external-content stage overlays"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: [docker]
  languages: []
  platforms: [docker]
  tags: [docker, multi-stage-build, ci, build-pipeline, file-placement]
summary: When a Docker build has a stage that overlays content from an external source (a cloned repo, a synced bucket) onto a data directory via `COPY`, any app-owned file you check into that same directory is at risk of being overwritten or shadowed at build time. Place app-owned data in its own sibling directory the overlay never targets.
---

## The failure mode

Multi-stage Docker builds often have two sources of truth for a `data/`
directory:

1. The **build stage** copies the whole app `data/` tree from the repo
   (`COPY --from=build /repo/app/data /repo/app/data`).
2. A later **external-content stage** clones or fetches content from a
   separate source and overlays specific subdirectories on top
   (`COPY --from=external-content /external/rules /repo/app/data/rules/`).

The overlay is a merge, not a wipe: `COPY src/. dest/` adds and overwrites
same-named files but leaves others in place. The trap is subtle precisely
because it usually *looks* fine — until a name collides.

If you check a new app-owned file into a directory that an overlay
targets (`data/rules/my-new-file.json`), one of two things happens at
build time:

- The external source has a file of the same name → **your file is
  silently overwritten** with the external version.
- The external source replaces the whole directory's intended contents
  via tooling that prunes-then-copies → **your file disappears**.

Either way it passes local `docker build` (no external stage) and only
breaks in the production build with `--build-arg ...=external`. The
symptom is a runtime "file not found" or stale-content bug that cannot
be reproduced locally.

## The fix: isolate app-owned data in its own directory

Give app-owned, repo-checked-in data its **own sibling directory that no
overlay stage targets**:

```
data/
  rules/         # overlaid by external-content stage — DO NOT add app files here
  app_rules/     # app-owned, only the build-stage `COPY data` brings it — safe
```

The whole `data/` tree is copied by the build stage, so a new sibling
directory ships automatically. Because no `COPY --from=external-content`
line names it, it is never overwritten or shadowed. Point the app at it
via an env var with a default (`APP_RULES_FILE=./data/app_rules/x.json`),
mirroring how the overlaid file is configured.

## How to decide where a data file belongs

Before adding any file under `data/`, ask: **does an external-content /
sync / clone stage `COPY` into this directory?**

- **Yes** → the directory is "owned" by the external source. Only files
  that legitimately come from there belong. Put app-owned files elsewhere.
- **No** → safe for app-owned files.

Grep the Dockerfile for `COPY --from=<content-stage>` lines and read
which destination directories they target. Those directories are
off-limits for app-authored files.

## When this does NOT apply

- **Single-stage builds** with no external overlay — every file under
  `data/` has one source; placement is free.
- **The file genuinely IS external content** — then it belongs in the
  overlaid directory and should be authored in the external source, not
  the app repo.
- **Overlay uses an explicit all-list copy of named files** (not a
  directory merge) — a new file is ignored rather than colliding; still
  cleaner to isolate, but the failure mode is absent.

## Anti-patterns

- **"It built locally, ship it."** Local builds skip the external stage.
  The collision only manifests in the production build arg. Always test
  the production build mode (or at least reason about which stages run).
- **Reusing the overlaid directory "because it's already there for
  rules."** Convenience now, silent overwrite later. The directory's
  ownership — not its current contents — decides placement.
- **Relying on COPY order to "win."** Overlay stages run after the build
  stage by design; app files placed in their path lose. Don't fight copy
  order; isolate instead.

## See also

Another build-time gotcha invisible to local builds:
[[lsn_auto_commit_package_json_review]]. Surface related build-pipeline
conventions with `search_lessons({query: "docker multi-stage build content", platforms: ["docker"]})`.
