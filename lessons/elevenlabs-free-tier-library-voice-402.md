---
id: lsn_elevenlabs_free_tier_library_voice_402
tier: community
title: "402 paid_plan_required from ElevenLabs TTS — free tier blocks library voices via API, use premade voices"
type: debugging_lesson
summary: "ElevenLabs free-tier accounts cannot call the TTS API with a legacy 'library' voice (e.g. Rachel 21m00Tcm4TlvDq8ikWAM) — the request returns HTTP 402 paid_plan_required ('Free users cannot use library voices via the API'). The current 'premade' voices (Sarah EXAVITQu4vr4xnSDxMaL, George, Jessica, ...) DO work on the free tier. GET /v1/voices lists exactly what the account may use."
context:
  tools: []
  languages: ["typescript", "javascript"]
  platforms: ["elevenlabs"]
  tags: ["elevenlabs", "tts", "api", "free-tier", "voice"]
---

## The symptom

A server-side ElevenLabs TTS call returns HTTP 402, not audio:

```json
{ "detail": { "type": "payment_required", "code": "paid_plan_required",
  "message": "Free users cannot use library voices via the API. Please upgrade your subscription to use this voice." } }
```

It fails for a specific voice ID — typically a long-standing default like
Rachel (`21m00Tcm4TlvDq8ikWAM`) copied from an old tutorial.

## The cause: library vs premade voices

ElevenLabs reclassified the legacy default voices as **library** voices, which
the free tier may NOT use via the API (only in the web app). The current
**premade** voice set is API-usable on free. They are global voice IDs (same for
every account):

| Voice | ID |
|---|---|
| Sarah (reassuring) | EXAVITQu4vr4xnSDxMaL |
| George (warm) | JBFqnCBsd6RMkjVDRZzb |
| Jessica (bright) | cgSgspJ2msm6clMCkdW9 |
| Brian (deep) | nPczCjzI2devNBz1zQrb |

## Fix: use a premade voice (and discover what your account allows)

```bash
# What can THIS account use via API? (category "premade" = free-OK)
curl -s https://api.elevenlabs.io/v1/voices -H "xi-api-key: $KEY" \
  | jq '.voices[] | {id: .voice_id, category, name}'
```

```ts
// model_id eleven_multilingual_v2 makes any voice speak many languages.
const res = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=mp3_44100_128`,
  { method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }) });
```

## When NOT to apply

- Paid plans can use library voices via API — the 402 won't fire.
- A 401 (not 402) means the API key itself is wrong, unrelated to voice tier.
