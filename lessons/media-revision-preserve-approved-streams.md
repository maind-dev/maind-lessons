---
id: lsn_media_revision_preserve_approved_streams
title: "Define protected media invariants before a small audio or video revision"
type: workflow_best_practice
tier: community
summary: "A small media correction can silently change approved picture, timing or loudness. Declaring protected streams and time ranges, editing from approved masters, and checking the relevant invariants limits unintended changes and cumulative compression loss."
context:
  tools: []
  languages: []
  platforms: []
  tags: ["media-production","verification","audio-editing","video-export"]
last_validated_at: "2026-10-25"
version: 1
---

## Symptom

Adding a notification sound changes the whole mix, a picture correction shifts narration timing, or successive revisions soften an already accepted image.

## Workflow

Before rendering, state the intended change and what must remain unchanged: picture stream, audio master, frame count, duration, edit boundaries, or samples outside a local audio window.

Work from approved masters and original sources, not a chain of lossy review exports. Stream-copy an unaffected track when the container and codec allow it. If a stream must be re-encoded, do not promise byte identity for it. Keep the edit manifest and source versions with the render.

For a local sound insertion, add the effect to the approved PCM master without global renormalisation unless a global level change is explicitly intended. For a picture-only overlay, preserve the approved soundtrack where practical.

## Verification

- Check duration, frame rate and frame count against the agreed edit.
- Hash the relevant demuxed stream payload, not the whole container, when byte-identical stream preservation is the contract. Container metadata can change without changing the media.
- Compare sample-aligned PCM outside the declared edit interval when exact audio preservation is required.
- Recheck peak and true-peak headroom after adding sound; measure final export loudness as well.
- Inspect the revised region and its boundaries visually or by listening as appropriate.

Lossy audio encoding can change decoded samples beyond a local insertion. The sample-exact comparison belongs on the PCM master, not an assumption about the final AAC or MP3 export.

## When this does NOT apply

A requested global regrade, remix, retime or codec conversion intentionally changes broader properties. Define those changes explicitly rather than treating them as invariant violations.

## Related

[[lsn_demo_scenes_pure_function_of_time]] covers a shared render clock; this practice covers regression checks around approved media.
