---
id: lsn_shader_time_uniform_precision_drift_wrap_phase
title: "Wrap a shader's time uniform on the CPU so the animation stops jittering over runtime"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [glsl, typescript]
  platforms: [webgl, threejs]
  tags: [shader, glsl, webgl, animation, precision, float, noise, sin-cos]
summary: "A shader animation driven by an ever-growing time uniform (iTime) is smooth at first but jitters more the longer it runs, then resets on refresh: GPU sin/cos and simplex noise lose precision at large arguments. Fix: accumulate each phase on the CPU (phase += dt*rate) and WRAP it (mod 2pi for sin/cos, mod a large constant for noise); clamp dt; pass the bounded phases as uniforms instead of the raw growing time."
last_validated_at: "2026-06-15"
---

## The symptom

A WebGL/GLSL animation (a glow, a noise field, an orbiting highlight) driven by
a time uniform looks perfect right after load, then over minutes develops a
**jitter / shimmer that gets worse the longer it runs**. A hard refresh makes it
smooth again. A persistent, always-on effect (one mounted since page load) shows
it first and worst; freshly-mounted instances look fine because their clock just
started.

## The cause: precision loss as time grows

The usual setup is `uniforms.iTime.value = (now - start) / 1000` — an
**unbounded** value — consumed in the shader as `sin(iTime * k)`,
`cos(iTime * k)`, or as a noise coordinate `noise(vec3(uv, iTime * k))`.

Two precision sinks scale with `iTime`:

1. **GPU `sin`/`cos` range reduction** is only accurate for modest arguments.
   Many GPUs reduce `x mod 2pi` with limited precision; for large `x` the result
   drifts and quantizes, so the phase steps unevenly frame to frame.
2. **Simplex/Perlin noise** computes the cell-local coordinate as
   `p - floor(p)` (and a skew that mixes a large time axis into the spatial
   ones). At large `p` this is **catastrophic cancellation** of two big floats →
   the fractional coordinate loses bits → the noise value jumps.

float32 on the GPU has ~7 significant digits; once the arguments reach the
hundreds/thousands the per-frame change can shrink to the same order as the
rounding error → visible jitter. It compounds with runtime and vanishes on
refresh (iTime back to ~0) — the tell-tale signature.

## The fix: accumulate and wrap phases on the CPU

Never hand the shader a value that grows forever. Integrate each phase per frame
on the CPU (float64, exact enough) and **wrap** it so the uniform stays small:

```ts
const TAU = Math.PI * 2;
let pSpin = 0;      // for cos/sin terms — wrap mod 2pi (seamless)
let pNoise = 0;     // for a noise time axis — wrap mod a large constant
let last = performance.now();

function frame() {
  const now = performance.now();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;                 // clamp tab-stall / background spikes

  pSpin  = (pSpin  + dt * spinRate)  % TAU;  // cos(angle - pSpin): wrap is invisible
  pNoise = (pNoise + dt * noiseRate) % 256;  // noise time: jump every ~minutes, organic → unnoticed

  uniforms.uSpin.value  = pSpin;
  uniforms.uNoiseT.value = pNoise;
  // ... render ...
}
```

In the shader, replace `iTime * k` with the matching bounded uniform
(`cos(ang - uSpin)`, `noise(vec3(uv, uNoiseT))`). For `sin/cos` the `mod 2pi`
wrap is mathematically seamless. For a noise time axis there's no exact period,
so wrap at a large constant — the once-every-several-minutes discontinuity in
organic noise is imperceptible (and the coordinate stays small → precise).

### Bonus when the rate is input-coupled

If you had `iTime * (base + audio * k)` to "speed up with volume," note that form
**re-scales the entire history** whenever the input changes, so the animation
*jumps* on input spikes. The incremental integral `phase += dt * (base + audio*k)`
is the correct continuous phase — bounded AND smoother (rate changes affect only
what comes next, no retroactive jump).

## Verification

- Let the effect run for the duration that previously degraded (often minutes)
  on a persistent instance — it must stay as smooth as right after refresh.
- Log the phase uniforms: they must stay within their wrap range forever, never
  trending upward.
- Cross-check on a second GPU/driver — range-reduction quality varies, so a bug
  invisible on one machine bites on another.
