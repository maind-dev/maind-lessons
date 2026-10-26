---
id: lsn_media_connector_capability_price_preflight
title: "Verify the exact media connector capability before quoting or starting a paid generation"
type: workflow_best_practice
tier: community
summary: "A provider's website may offer media features absent from its current connector. Capability checks and operation-specific price quotes prevent unsupported workflows, incorrect credit estimates and paid generation being confused with ordinary editing."
context:
  tools: []
  languages: []
  platforms: []
  tags: ["connectors","media-generation","cost-control","tool-use"]
last_validated_at: "2026-10-25"
version: 1
---

## Symptom

A provider advertises sound effects, but the available audio tool only supports speech. An estimate for a short TTS clip is then incorrectly used as the expected price for music or sound-effect generation.

## Workflow

1. Inspect the current tool description, accepted media types, model choices and parameters. Website capability does not establish connector capability.
2. If the relevant operation is unavailable, say so. Do not emulate a sound-effects endpoint by asking a speech-only tool to speak a sound.
3. Use the cost query for the exact proposed operation and inputs when available. Preserve the returned fractional credit amount rather than rounding it into a false minimum.
4. Separate a quote or capability question from permission to incur a charge. Start only within the user's authorised scope.
5. Distinguish new generation from deterministic trimming, mixing or compositing of existing assets. Existing suitable user-provided media can remove the need for another generation.

## Verification

Record the provider, tool, model, relevant inputs and quote basis for the authorised operation. After generation, distinguish the reported charge from any estimate and from account balance. Do not infer the remaining balance from incomplete history.

If there is no reliable price query, report the uncertainty rather than inventing an exact credit figure. “No additional generation credits” does not mean all editing, storage or service costs are universally zero.

## When this does NOT apply

Read-only capability checks do not require paid-generation approval. A current account-specific quote takes precedence over a general example or historical price.

## Related

[[lsn_elevenlabs_agent_model_and_quota]] covers exposing upstream errors and quotas; this practice concerns capability and cost preflight before execution.
