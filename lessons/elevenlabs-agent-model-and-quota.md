---
id: lsn_elevenlabs_agent_model_and_quota
tier: community
title: "ElevenLabs TTS fails with an opaque 502 (often quota_exceeded) — surface the upstream status; flash_v2_5 for latency"
type: debugging_lesson
summary: "Two ElevenLabs gotchas for a voice agent. (1) If your route maps every provider error to a generic 502, you cannot tell quota from auth from a bad voice — the free tier's 10,000 chars/month exhausts fast under testing, returning 401 quota_exceeded, which becomes an opaque 502 and a silent fallback. Surface the upstream status/code; check credits via GET /v1/user/subscription. (2) For latency prefer eleven_flash_v2_5 (~75 ms vs ~250 ms+, half the cost, 32 languages) over multilingual_v2."
context:
  tools: []
  languages: ["typescript", "javascript"]
  platforms: ["elevenlabs"]
  tags: ["elevenlabs", "tts", "latency", "error-handling", "quota"]
---

## Gotcha 1: a generic 502 hides the real reason

A route that maps any ElevenLabs non-2xx to one generic status loses the cause.
The free tier is **10,000 characters/month** and is easy to exhaust while testing
a voice agent; ElevenLabs then returns:

```
HTTP 401 { "detail": { "status": "quota_exceeded",
  "message": "You have 0 credits remaining …" } }
```

If your handler turns that into a bare 502 and the client silently falls back to
browser speech, you debug "no sound" for a long time. Instead:

- Log the upstream status + body server-side and surface a distinct reason to the
  client (e.g. "quota exhausted") rather than an opaque 5xx.
- Check credits directly:

```bash
curl -s https://api.elevenlabs.io/v1/user/subscription -H "xi-api-key: $KEY" \
  | jq '{tier, used: .character_count, limit: .character_limit}'
```

## Gotcha 2: pick the low-latency model

`eleven_multilingual_v2` has noticeably higher time-to-first-byte (~250 ms+). For
an interactive agent prefer **`eleven_flash_v2_5`**: ~75 ms TTFB, about half the
cost per character, still 32 languages (incl. German). The premade voices support
it.

```ts
const MODEL = process.env.ASSISTANT_ELEVENLABS_MODEL?.trim() || "eleven_flash_v2_5";
```

## When NOT to apply

- Paid tiers will not hit the 10k free quota, but still surface upstream errors.
- If you need the highest fidelity over latency (narration, not a live agent), a
  higher-quality model may be worth the extra milliseconds.
