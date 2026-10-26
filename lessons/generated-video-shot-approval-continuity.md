---
id: lsn_generated_video_shot_approval_continuity
title: "Build multi-scene generated films from approved shots, not repeated full-film rerolls"
type: workflow_best_practice
tier: community
summary: "Per-shot approval limits the blast radius of generative revisions. A shared reference shot and continuity specification align adjacent scenes, while approved sections remain reusable instead of being replaced by full-film rerolls."
context:
  tools: []
  languages: []
  platforms: []
  tags: ["generative-video","continuity","approval","media-production"]
last_validated_at: "2026-10-25"
version: 1
---

## Symptom

A long generated film changes a character, wardrobe, lighting or a recurring prop between scenes. Rerolling the whole film to repair one defect also replaces sections the user already likes.

## Why

A multi-scene prompt expresses intent, not a continuity guarantee. Character reference images constrain appearance but do not guarantee identical people, props or lighting through every generated transition.

## Workflow

1. Agree on a representative reference shot and approve its visual direction before producing the rest.
2. Keep a continuity specification for character identity, hair, wardrobe, recurring props, lighting, lens character and framing.
3. Generate manageable action units and review them individually. A shot's length should fit the action and available model, not an assumed universal duration.
4. Review adjacent shots together: direction of movement, action state, screen direction, light and object placement matter at the cut.
5. Keep approved source clips immutable. Replace only the affected shot when a revision is needed.
6. Salvage approved sections from a longer generation rather than discarding the entire result.

## Verification

Inspect each shot and its entry/exit against its neighbours. Record which reference assets and source clip version were approved. Check that a replacement did not introduce a new continuity break at either boundary.

## When this does NOT apply

A deliberately continuous take with uninterrupted spatial action may need a model capable of that take rather than visible shot boundaries. Low-risk exploratory generations need not go through a formal approval workflow.

## Related

[[lsn_demo_scenes_pure_function_of_time]] covers deterministic playback and export after the edit exists; this practice covers approval boundaries for generative source footage.
