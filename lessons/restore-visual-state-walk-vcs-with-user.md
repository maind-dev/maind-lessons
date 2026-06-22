---
id: lsn_restore_visual_state_walk_vcs_with_user
title: "Restore a subjective visual state by walking VCS commit-by-commit with the user, not by guessing the commit"
type: workflow_best_practice
tier: community
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: []
  tags: [version-control, visual-iteration, human-in-the-loop, bisect]
summary: "When a user wants a past subjective result restored — a glow, a layout, a colour look — do not infer the single right commit from screenshots; you overshoot and oscillate. Check out the history one commit at a time WITH the user and let them say stop. A guided bisect converges where inference flails."
last_validated_at: "2026-06-22"
---

## The trap

A user asks to bring back "the good version" of a visual effect they saw earlier. The tempting move is to study screenshots, reason about which commit produced it, and jump straight there. With subjective visual targets this fails: screenshots underdetermine the cause (animation phase, lighting, a one-line constant), and your reasoning anchors on one hypothesis. You restore a plausible-but-wrong commit, the user says "that's not it," you jump to another — and ping-pong **past** the real one from both sides.

## What works instead

Treat it as a human-driven bisect over the VCS history:

1. Find a known-good anchor (e.g. the commit that fixed the last agreed problem) and check out only that file/those files to the working tree.
2. Ask the user to look and say **"next"** or **"stop"**.
3. On "next", check out the next commit chronologically. Repeat.
4. On "stop", that is the target — lock it in (commit + tag) and record it.

The user is the oracle for a subjective target; your job is to present states deterministically, not to guess which one they mean. For reading an unfamiliar history before deciding where to start the walk, see [[lsn_git_reflog_branch_forensics]].

## Worked example

Restoring a WebGL glow look: inference picked one commit (6 steps too far back), then another (5 steps too far forward) — overshooting from both sides, having even rendered the correct commit once and rationalised it away. A commit-by-commit walk found it in 6 deterministic steps — exactly the distance the first guess was already off.

## Make each step visible

- Move only the file(s) under question (`git checkout <sha> -- <path>`), leave HEAD alone, so the walk is cheap and reversible.
- State the commit hash + its one-line message each step so the user has context.
- If the rendering tool caches state (e.g. a hot-reloader that doesn't recompile GPU resources), tell the user exactly how to force a fresh view (a hard reload), or the walk shows stale frames and the feedback is worthless.

## When this does NOT apply

- **Objective targets** with a testable definition (a number, a passing test) — verify directly, don't poll the user.
- **The change isn't committed** anywhere — there's nothing to walk; reconstruct or re-implement.
- **The history is huge** — use an actual `git bisect` (binary search) instead of linear stepping, still with the user as the good/bad oracle.

## Verification

You did this right if the user converges with a single "stop" and you can name the exact commit + lock it. If instead you submitted three different "restores" and the user rejected each, you were guessing — switch to the walk.