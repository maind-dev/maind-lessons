---
id: lsn_webgl_particle_glow_dual_blend_light_dark
title: "Fix invisible particle glow on light backgrounds with a two-pass NormalBlending + AdditiveBlending field"
type: debugging_lesson
tier: community
lesson_class: general
quality_tier: experimental
context:
  tools: []
  languages: ["typescript", "glsl"]
  platforms: ["web"]
  tags: ["webgl", "three.js", "shaders", "blending", "canvas", "animation"]
summary: "Additive blending makes glowing particles brighter than the background, but it can never exceed white — so on a near-white surface the glow turns invisible and the dots vanish. Render two passes sharing one geometry: a NormalBlending base pass keeps dots visible on light backgrounds, and an AdditiveBlending glow pass whose alpha scales with per-particle energy blooms only where excited. The additive glow reads strongest on dark themes by nature."
last_validated_at: "2026-06-03"
---

## Why additive-only fails on a light background

Additive blending sums the source colour onto the destination: `dst += src.rgb * src.a`. On a dark canvas that turns overlapping particles into a bright bloom — exactly the glow you want. But the result clamps at white (1.0). On a near-white surface the destination is already ~1.0, so adding more light changes nothing: the glow is invisible, and faint grey idle dots disappear too. This is a property of the blend math, not something to tune away.

## The two-pass fix (one geometry, two materials)

Render the same `THREE.Points` geometry twice with two materials and an explicit draw order:

```ts
// Base pass — visible on light AND dark; dots fade grey→accent with energy.
const base = new THREE.ShaderMaterial({
  blending: THREE.NormalBlending, transparent: true, depthTest: false, depthWrite: false,
  // frag: gl_FragColor = vec4(mix(uGray, aColor, aEnergy), alpha);
});
// Glow pass — additive bloom; alpha scales with energy² so it blooms only when excited.
const glow = new THREE.ShaderMaterial({
  blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
  // frag: gl_FragColor = vec4(aColor, soft * aEnergy * aEnergy * uGlowStrength);
});
const basePts = new THREE.Points(geometry, base); basePts.renderOrder = 0;
const glowPts = new THREE.Points(geometry, glow); glowPts.renderOrder = 1;
scene.add(basePts, glowPts);
```

Both passes are co-planar (z = 0), so disable depth and let `renderOrder` decide layering. Gating the glow's alpha by an energy term means the idle field adds no additive wash; only moving or excited particles bloom.

## Theme handling

Accent colours are usually theme-independent, so only the idle grey and the glow strength change between light and dark — update two uniforms instead of rebuilding the scene. On light themes, raise the base-pass opacity or dot size to compensate for the physically weaker additive glow.

## When NOT to use this

If you only ever render on a fixed dark surface, a single additive pass is simpler and enough. If the particles are opaque and non-glowing (no bloom intended), one NormalBlending pass suffices — the second pass is pure overhead.