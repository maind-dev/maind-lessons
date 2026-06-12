---
id: lsn_browser_tts_autoplay_unmuted_unlock
tier: community
title: "Fix silent browser TTS autoplay — unlock with an UNMUTED, non-zero clip and keep the audio element stable"
type: debugging_lesson
summary: "Auto-played fetched TTS audio stays silent until the user clicks, even though play() resolves. Fixes: (1) the gesture unlock must play an UNMUTED, non-zero-duration clip — muted or 0-sample only grants MUTED autoplay; (2) the SAME audio element must survive re-renders (an unstable-dep cleanup effect destroys it so it is never blessed); (3) a detached element is silent on Chrome so attach it to the DOM; (4) CSP needs media-src 'self' blob: data:."
context:
  tools: []
  languages: ["typescript", "javascript"]
  platforms: ["browser"]
  tags: ["web-audio", "autoplay", "tts", "voice-agent", "csp"]
---

## The symptom

A voice agent fetches TTS audio, calls `play()`, the promise resolves, the UI
shows a speaking state — but there is **no sound** until the user clicks
somewhere. Clicking anything makes it audible. The element reports playing; it is
just force-muted by the autoplay policy.

## Fix 1: the unlock must be UNMUTED and NON-zero-duration

To play unmuted audio later WITHOUT a fresh click, the element must have
completed an **unmuted** `play()` during a prior user gesture. Two traps:

- A **muted** unlock (`a.muted = true; a.play()`) only grants *muted* autoplay —
  the later unmuted reply is force-muted (state says "speaking", no sound).
- A **0-sample** clip (a 0-length WAV data-URI) does not reliably count as a real
  playback, so the element is never blessed.

Play a short, real, **silent** clip **unmuted** in the gesture:

```ts
function unlock(a: HTMLAudioElement) {
  a.muted = false;            // UNMUTED — grants unmuted autoplay
  a.volume = 1;
  a.src = silentClipUrl();    // ~150 ms of true silence (blob:), NON-zero
  void a.play().catch(() => {/* next gesture retries */});
  // Do NOT pause it mid-flight — let it end (inaudible). Pausing a pending
  // play() aborts it ("interrupted by pause()") and the element stays unblessed.
}
```

Call `unlock()` on the earliest gestures (panel-open / mic / send).

## Fix 2: keep the SAME element across renders

The blessing lives on one element instance. If a re-render destroys and recreates
the `<audio>`, the new one is unblessed → silent again. The classic cause is an
unmount-cleanup effect that depends on an unstable callback and so runs its
teardown on every render — see [[lsn_react_unmount_cleanup_unstable_dep]]. Create
the element once (ref) and tear it down only on real unmount (`[]` deps).

## Fix 3 + 4: detached element + CSP

- A detached `new Audio()` can have `play()` resolve yet emit nothing on Chrome →
  attach it to the DOM (`document.body.appendChild`, `display:none`).
- `default-src 'self'` blocks the `blob:` (fetched audio) and `data:` (unlock
  clip) sources → add `media-src 'self' blob: data:`.

## When NOT to apply

- `<audio controls>` the user clicks directly needs no unlock.
- A real-amplitude visualizer must route through Web Audio (`MediaElementSource`)
  and keep the context resumed — accept the fragility, or drive the visual from a
  synthetic envelope instead.
