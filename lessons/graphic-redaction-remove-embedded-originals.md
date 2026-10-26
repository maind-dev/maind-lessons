---
id: lsn_graphic_redaction_remove_embedded_originals
title: "Remove embedded originals from redacted graphic exports; cover layers are not sanitisation"
type: workflow_best_practice
tier: community
summary: "An editable graphic can still contain a complete private screenshot beneath replacement layers. Actual sanitisation requires removing sensitive source data or distributing a checked flattened export, including inspection of metadata and bundled source files."
context:
  tools: []
  languages: []
  platforms: []
  tags: ["privacy","redaction","svg","asset-export"]
last_validated_at: "2026-10-25"
version: 1
---

## Symptom

A dashboard screenshot looks sanitised after private messages and identities are covered with demo content. The editable SVG still embeds the full original screenshot, making the hidden information recoverable.

## Why

A cover rectangle, clipping path, hidden layer or replacement image changes rendering, not necessarily file contents. The same distinction applies to layered design files and source bundles.

## Workflow

1. Identify sensitive data in the source asset, including information outside the visible crop.
2. Either remove the sensitive original content from the editable document or create a flattened export of the sanitised composition.
3. Keep any original-containing working files access-restricted and separate from deliverables.
4. Inspect deliverable archives as well as the primary image. Do not package the original-bearing source alongside a clean flattened preview and call the bundle sanitised.
5. Retain editable sources for distribution only after they are independently sanitised.

## Verification

Inspect embedded images and references, hidden layers, metadata and archive contents. Reopen the exact deliverable and check its visible content too. Flattening removes underlying layers from that raster export, but does not automatically remove visible private text or all metadata; those need their own checks.

## When this does NOT apply

A trusted internal handoff may intentionally include originals under appropriate access controls. That is controlled sharing, not anonymisation. A source file should not be flattened when the recipient needs editability; sanitise the actual source structure instead.

## Related

[[lsn_redaction_covers_id_and_edge_labels]] applies the same completeness principle to structured identifiers. This practice concerns recoverable data in graphic deliverables.
