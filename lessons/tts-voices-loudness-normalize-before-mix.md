---
id: lsn_tts_voices_loudness_normalize_before_mix
title: "Fix one narrator sounding much louder than the others — normalize each TTS voice's loudness before the mix chain"
type: debugging_lesson
tier: community
context:
  tools: [ffmpeg]
  languages: [bash]
  platforms: []
  tags: [product-demo, tts, audio, ffmpeg, loudness]
summary: "TTS voices come out at very different loudness: across five premade voices one measured about 7 dB hotter than the rest. A shared compressor and limiter does not even that out; it squashes the loud voice audibly and shifts the voice-to-music balance. Measure each narration track's integrated loudness with ffmpeg's ebur128 filter and gain it to a common target before compression, music and ducking."
last_validated_at: "2026-10-13"
---

## Symptom

A set of narrated clips, each with its own TTS voice, all run through the same mix chain (EQ, compressor, limiter, music bed with sidechain ducking, final loudness target). One clip sounds clearly louder and harsher than its siblings; in another the music suddenly feels too quiet. Every clip individually "looks" correct — same script, same chain, same targets.

## Cause

TTS providers do not normalize output loudness across voices. Timbre alone moves integrated loudness by several dB — measured on five premade voices of one provider, the loudest sat about 7 dB above the rest.

A fixed chain then treats the voices differently: the compressor and limiter work much harder on the hot voice (audible pumping and flattened delivery), and because the music bed has a fixed gain, the voice-to-music balance differs per clip. A loudness target on the *final* mix only fixes the total — it cannot restore the balance.

## Fix

Normalize the narration track first, then run the unchanged chain.

```bash
# 1) Integrated loudness of the narration alone (not the mix). The summary line comes last.
I=$(ffmpeg -hide_banner -nostats -i narration.wav -af ebur128 -f null - 2>&1 \
     | awk '/ I: /{v=$2} END{print v}')

# 2) Gain to a common target before anything else touches the signal.
TARGET=-24
GAIN=$(echo "$TARGET - ($I)" | bc -l)     # e.g. -24 - (-17.3) = -6.7 dB for a hot voice

ffmpeg -y -i narration.wav \
  -af "volume=${GAIN}dB,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,alimiter=limit=0.89" \
  voice-normalized.wav
```

Then mix as before — music at its fixed level, ducking keyed on the now-normalized voice. Choose the target a little below where your chain wants the voice, so the compressor still has something to do.

## Verification

- Re-measure every finished clip with `ebur128=peak=true`: integrated loudness within about ±1 LU across clips, true peak below −1 dBTP.
- Listen to two clips back to back with different voices at a fixed playback volume. Neither should make you reach for the volume knob.
- Pin it: a test that reads the measured voice loudness per clip (written by the mix script) and fails when a new voice lands outside the window.

Related search: `search_lessons({ query: "tts voice loudness mix normalize", tags: ["tts"] })`.

## When NOT to use this

- One voice for everything — there is nothing to balance; a final loudness target is enough.
- Providers or pipelines that already deliver loudness-normalized output (check by measuring, not by reading the docs).
- Human-mastered audio, where an engineer balances each clip by ear.

Related: [[lsn_browser_tts_autoplay_unmuted_unlock]] covers getting the mixed audio to actually play in the browser.
