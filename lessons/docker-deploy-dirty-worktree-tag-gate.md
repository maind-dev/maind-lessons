---
id: lsn_docker_deploy_dirty_worktree_tag_gate
title: "A 'HEAD must be tagged' deploy gate still ships uncommitted code when Docker builds from the working tree"
type: workflow_best_practice
tier: community
lesson_class: general
context:
  tools:
    - docker
    - git
  languages: []
  platforms: []
  tags:
    - docker
    - deploy
    - release
    - ci
    - reproducible-build
summary: "A deploy script that refuses unless HEAD is tagged still ships uncommitted changes if the Docker image is built from the working directory (COPY . .). The tag-gate checks only the commit pointer, not the build context — so uncommitted/untracked WIP on disk at build time goes live, while the tag and changelog assert a clean release the image does not match. Build from the tagged commit (git archive) or add a clean-tree check."
gotchas:
  - "A tag-on-HEAD check verifies the commit pointer, not that the working tree equals that commit."
  - "Dockerfile COPY uses the build context (the live directory), so uncommitted and untracked files ship even on a 'tagged' deploy."
  - "Shared working trees (parallel sessions) make this acute — peer WIP present at build time goes live."
last_validated_at: "2026-06-02"
---

## The false sense of safety

A release script guards the deploy:

```python
if tag not in git("tag", "--points-at", "HEAD"):
    refuse("HEAD is not tagged as <release>; refusing to deploy an unreleased build")
```

This *feels* like "we only ship tagged releases." It is not. The check verifies the **commit pointer** (HEAD carries the tag). The image is built from the **build context** — and a Dockerfile that does:

```dockerfile
COPY apps/my-service/ ./apps/my-service/
```

copies the **working directory as it is on disk right now**: uncommitted edits, untracked files, half-finished work. Tag-on-HEAD says nothing about whether the working tree equals the tagged commit.

## How it bites

In a shared working tree (parallel agent sessions, or one developer mid-feature), WIP present at build time is baked into the "released" image. You ship code that was never committed, never reviewed, and is not in the tag — while the tag and changelog assert a clean release the image does not match. The drift stays invisible until someone diffs the running image against the tag.

## Detect

```bash
# Is the working tree actually clean at the tagged commit?
git status --porcelain          # must be empty for a reproducible build
[ -z "$(git status --porcelain)" ] || echo "DIRTY TREE — the image will not equal the tag"
```

## Fix: build from the tagged commit, not the tree

Make the build context a function of the version, so the image is reproducible:

```bash
# Export the exact tagged tree into a clean context:
rm -rf /tmp/rel && mkdir -p /tmp/rel
git archive --format=tar "<tag>" | tar -x -C /tmp/rel
docker build -f /tmp/rel/path/to/Dockerfile /tmp/rel
```

If a full archive-build is too heavy, at least gate the deploy on a clean tree in addition to the tag:

```bash
[ -z "$(git status --porcelain)" ] || { echo "refuse: dirty working tree"; exit 1; }
```

## When this does not apply

If your CI builds in a fresh checkout of the tag (the normal hosted-CI case — the runner clones the ref into an empty workspace), the build context already equals the commit and this gap does not exist. It is specific to building from a long-lived local working tree. Single-developer, always-commit-before-deploy flows are lower risk but still benefit from the clean-tree gate as a backstop.

## Related

- Shared working trees amplify this — see [[lsn_parallel_sessions_first_ask]] for the peer-WIP safety stance.
- Auto-commits that touch build inputs have a related fresh-build trap: [[lsn_auto_commit_package_json_review]].
- Surface this from a session with `search_lessons({ query: "docker deploy reproducible build from git tag", tools: ["docker"] })`.
