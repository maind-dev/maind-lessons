---
id: lsn_web_audio_media_element_source_strictmode_silent
title: "Fix silent playback after adding a Web Audio analyser — createMediaElementSource reroutes and runs once per element"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript]
  platforms: [react, nextjs]
  tags: [web-audio, audiocontext, analysernode, react, strictmode, useeffect, autoplay]
summary: "createMediaElementSource reroutes an element's audio INTO the graph, so it stops reaching the speakers unless you connect onward to ctx.destination — and it may be called only once per element. StrictMode's mount→cleanup→mount then throws on the second call while the cleanup already closed the context, leaving the element bound to a dead one: play() resolves and nothing is audible. Use one module-level context plus a per-element WeakMap cache."
last_validated_at: "2026-06-15"
---

## The symptom

You add an audio visualizer or level meter: take an `<audio>` element, build an
`AnalyserNode`, read `getByteFrequencyData` in a rAF loop. Suddenly the element
plays **no sound** — but `audio.play()` resolves successfully and throws nothing.
In React dev it reproduces every time; in production it appears only after the
component remounts.

## Three compounding causes

1. **`createMediaElementSource` reroutes the audio.** The moment you call it, the
   element's output is pulled INTO the graph and no longer reaches the speakers
   directly. If you only `source.connect(analyser)` and never connect onward, the
   sound dead-ends in the analyser. You must `analyser.connect(ctx.destination)`.

2. **A suspended context is silent.** Under the autoplay policy the `AudioContext`
   can start `suspended`. Rerouted audio through a suspended context produces no
   output even though `play()` succeeds. Call `ctx.resume()` from a real user
   gesture — the same click that starts playback.

3. **Once-per-element + effect double-invoke is the real killer.**
   `createMediaElementSource(el)` may be called **only once per element**; a
   second call throws `InvalidStateError`. React StrictMode (Next.js dev) invokes
   every effect twice: **mount → cleanup → mount**. The naive lifecycle

   ```ts
   useEffect(() => {
     const ctx = new AudioContext();
     const source = ctx.createMediaElementSource(audio); // OK on mount #1
     // ...
     return () => ctx.close();                           // closes ctx1
   }, []);
   // mount #2: createMediaElementSource THROWS (already created on this element)
   ```

   builds the source on `ctx1`, the cleanup **closes `ctx1`**, then the second
   mount throws inside `createMediaElementSource`. The element is now permanently
   bound to the **closed** `ctx1` → silent. This is not dev-only: any real
   remount in production reproduces it.

## The fix: shared context + per-element cache

Make the graph **survive remounts**. One module-level context that is never
closed, and a `WeakMap` that caches the analyser per element so a remount reuses
the existing graph instead of rebuilding it:

```ts
let sharedCtx: AudioContext | null = null;
const graphCache = new WeakMap<HTMLMediaElement, AnalyserNode>();

function getSharedCtx(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  sharedCtx ??= new AudioContext();
  return sharedCtx;
}

function getAnalyser(el: HTMLMediaElement): AnalyserNode | null {
  const cached = graphCache.get(el);
  if (cached) return cached;                 // remount: reuse, never rebuild
  const ctx = getSharedCtx();
  if (!ctx) return null;
  try {
    const source = ctx.createMediaElementSource(el); // exactly once per element
    const analyser = ctx.createAnalyser();
    source.connect(analyser);
    analyser.connect(ctx.destination);       // rerouted sound must reach output
    graphCache.set(el, analyser);
    return analyser;
  } catch {
    return null;                             // already created elsewhere → leave sound intact
  }
}
```

In the effect: `getAnalyser(el)`, `resume()` if suspended, run the rAF loop, and
in cleanup **cancel only the rAF** — do NOT close the context or disconnect the
source. The `WeakMap` frees the entry when the element itself is garbage-collected.

## Verification

- Toggle React StrictMode on: audio must still play after the double-mount.
- Confirm sound survives unmount → remount of the component (route change, list
  re-key) — the classic production repro.
- The analyser still produces non-zero levels, which proves the graph reaches the
  destination.
- If you deliberately skip the analyser (feature-detect fails), playback must be
  unaffected — hence the `try/catch` returning `null` rather than throwing.

## When this does not apply

- Playback with no Web Audio graph at all: a plain `<audio>` element is never
  rerouted, so silence there has another cause.
- `createBufferSource` / `decodeAudioData` pipelines: those are not bound to a
  media element and carry no once-per-element restriction.
- Silence that persists with a resumed context AND a first-ever mount: check the
  element's own `muted`/`volume` and the autoplay policy before rebuilding the
  graph.

## Retrieving this and its neighbours

```js
search_lessons({ query: "web audio analyser silent playback strictmode createMediaElementSource", platforms: ["react"] })
```

- [[lsn_browser_tts_autoplay_unmuted_unlock]] — the autoplay-unlock sibling: an
  unmuted, non-zero clip and a stable audio element.
- [[lsn_react_strictmode_dev_resource_churn_diagnose_on_prod_build]] — the
  general shape: StrictMode's double-mount breaking singleton resources.
- [[lsn_react_unmount_cleanup_unstable_dep]] — the cleanup half, where a
  long-lived resource is torn down on every render.
