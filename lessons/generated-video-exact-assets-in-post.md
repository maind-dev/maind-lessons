---
id: lsn_generated_video_exact_assets_in_post
title: "Keep exact logos, readable UI and brand typography out of generative source footage"
type: workflow_best_practice
tier: community
summary: "Generated footage can destabilise logos, device labels and readable UI across frames. Compositing controlled original assets in post-production separates exact brand information from generated people, environments and motion."
context:
  tools: []
  languages: []
  platforms: []
  tags: ["generative-video","compositing","branding","screen-replacement"]
last_validated_at: "2026-10-25"
version: 1
---

## Symptom

A generated device changes branding between shots, a wordmark wobbles, or a chat message appears despite a request for a blank screen. Repeated generative retouches introduce soft rectangles or unstable edges.

## Why

A negative prompt is not a guarantee of a clean plate. Generative footage is useful for natural scenes and motion, but exact typography and temporal consistency of fine graphics require separate control.

## Workflow

- Request a simple screen or suitable blank area in the source footage, then inspect the actual result.
- Use supplied vector logos and controlled UI assets for the final brand elements. Do not regenerate an exact wordmark as part of the scene.
- Track screen geometry over time and warp the replacement into the screen plane.
- Match brightness, focus and texture to the shot. Preserve the bezel, hands and other occluding objects with appropriate masks.
- Add notifications and messages as independent timed layers, so copy and display duration can change without regenerating the actor.
- If a generative repair leaves an obvious patch, evaluate deterministic compositing before buying another retouch. An overlay is acceptable only when it also fits the intended story and framing.

## Verification

Inspect the entire affected interval, especially moving edges, occlusions, cuts and fade boundaries. A still frame validates placement at one instant, not temporal stability. Check the final render for unwanted original text or logos.

## When this does NOT apply

Incidental, deliberately unreadable fictional graphics need not be rebuilt. A screen with complex reflections or occlusion may require a specialist tracking workflow; a simple corner warp alone is not a complete repair.

## Related

[[lsn_screenshot_calibrate_visual_geometry]] supports visual inspection. [[lsn_mockup_labels_pinned_both_ways]] addresses drift in product labels, not their integration into footage.
