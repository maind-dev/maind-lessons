---
id: lsn_media_preview_failure_not_generation_failure
title: "Diagnose a missing media preview before regenerating an existing result"
type: workflow_best_practice
tier: community
summary: "A missing inline preview does not establish that media creation failed. Checking the existing artifact, upload state and supported display path separates delivery failures from generation failures and avoids unnecessary paid rerolls."
context:
  tools: []
  languages: []
  platforms: []
  tags: ["media-delivery","preview","verification","cost-control"]
last_validated_at: "2026-10-25"
version: 1
---

## Symptom

A user reports that an image or video is not displayed. A remote file or completed generation may already exist, but the assistant considers creating the content again.

## Workflow

Separate three states: the artifact was created, the artifact is technically valid and uploaded, and the user can display or play it. None alone establishes the other two.

Check the existing result first: job completion where relevant, file existence, nonzero size, readable media metadata and any required upload confirmation. Then use the product's supported native media preview with that same result. If a preview is unavailable, provide an appropriate existing-file download through a supported channel.

Only regenerate when the source output is absent, corrupt or actually unsuitable, and any required paid-operation authorisation is in place. An alternate preview method should not silently become a new generation.

## Verification

Confirm which exact version is being delivered, not merely that some file exists. Track upload and display outcomes separately. Successful probing establishes technical properties, not the user's ability to see the result or the quality of the viewing experience.

A transcript, metadata probe, screenshot or waveform also has a limited evidentiary scope. Do not claim to have heard or watched content when the active tools did not provide that perceptual access. State the unverified part and ask for targeted feedback when necessary.

## When this does NOT apply

A valid file may still contain poor output, unsupported codec details or the wrong edit. Technical validity is not aesthetic approval, and a genuinely defective render may need rebuilding.

## Related

[[lsn_background_task_read_output_before_theory]] supports checking actual output before theorising. This practice adds media-specific delivery and perception boundaries.
