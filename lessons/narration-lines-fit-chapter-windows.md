---
id: lsn_narration_lines_fit_chapter_windows
title: "Synthesize demo narration line by line and test that every line fits its chapter window instead of timing one long take"
type: workflow_best_practice
tier: community
context:
  tools: []
  languages: [typescript]
  platforms: []
  tags: [product-demo, tts, narration, testing]
summary: "For a narrated product demo, generate each narration line as its own TTS clip, write its measured duration into a generated timing file, and fail a unit test when a line runs into the next chapter. Fix an overrun by moving the chapter start or shortening the line, never by speeding up the voice. Keep spoken text and caption text apart so the TTS never reads symbols aloud."
last_validated_at: "2026-10-13"
---

## Why one continuous take fails

The obvious way to narrate a 20-second demo is to write the script, synthesize it once and animate against the audio. It breaks on the first edit: changing one sentence shifts every later sentence, and the animation has to chase the new audio. TTS durations also move under you — a different voice, a model update or one extra comma changes the length — and nothing tells you until someone watches the whole thing.

Treat chapters as the design and lines as content that must fit into them.

## The pipeline

1. Lines live in source, each with the chapter it belongs to: `{ id: "ch2", at: 6.8, text: "…" }`.
2. A script synthesizes every line separately, measures it and writes a generated file — `narration-timing.generated.ts` with `{ id, duration, text }`. Measure the real file, not an estimate:

   ```bash
   ffprobe -v error -show_entries format=duration -of csv=p=0 out/ch2.mp3   # → 4.213
   ```

3. The mixer places each clip at its chapter start plus a short lead-in; captions use the same numbers, so they cannot drift from the voice.
4. A plain unit test guards the fit — it reads only the generated file, so it runs in CI without audio tooling:

   ```ts
   for (const [i, line] of LINES.entries()) {
     const measured = TIMING[line.id];
     assert.equal(measured.text, line.text, `${line.id}: text changed — regenerate the audio`);
     const end = line.at + LEAD + measured.duration;
     const next = LINES[i + 1]?.at ?? DURATION;
     assert.ok(end + MIN_GAP <= next, `${line.id} overruns its chapter by ${(end + MIN_GAP - next).toFixed(2)} s`);
   }
   ```

Storing the text next to the measured duration matters: without it the test happily checks yesterday's timing against today's sentence.

## When a line does not fit

- **Move the chapter start**, if the scenes are driven by one clock (scenes as a pure function of time): shifting a cue is a one-number edit, and the rest of the demo follows.
- **Shorten the sentence.** Spoken copy is usually too long; cutting a clause beats cramming.
- **Do not raise the speaking rate.** A voice at 1.15× sounds rushed next to the other lines and is the first thing viewers notice.

## Gotchas

- **The TTS reads what you write.** Arrows, `#123`, `v1.2`, `e.g.` and code identifiers come out literally or mangled. Keep a spoken variant next to the caption variant, and add a test that forbids such marks in the spoken text.
- **Regenerate, then re-run the test**, whenever a line, voice or model changes — the generated file is the measurement, and a stale one is a stale guarantee.
- **Leave a gap** (a few hundred milliseconds) between lines; back-to-back clips sound like one breathless sentence even when they technically fit.

Related search: `search_lessons({ query: "tts narration timing chapters demo", tags: ["product-demo"] })`.

## When NOT to use this

- A human voice-over recorded in one session — the performer paces to the picture, and per-line splicing sounds choppy.
- Clips with a single sentence or without chapters; there is nothing to fit.
- Real-time voice agents: latency, not fit, is the constraint there.
