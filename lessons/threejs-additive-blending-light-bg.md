---
id: lsn_threejs_additive_blending_light_bg
title: "Fix invisible WebGL glows/edges on light backgrounds — AdditiveBlending saturates to white"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [web]
  tags: [threejs, webgl, blending, transparent-canvas, light-theme]
summary: "THREE.AdditiveBlending adds fragment color to the backdrop — over white/off-white backgrounds the sum saturates toward white, so glows and edge lines become invisible. A scene designed on a dark panel loses its halos entirely on a transparent canvas over a light page. Use NormalBlending (plus alpha) for light backdrops; scene fog and hover-dim lerp targets must follow the PAGE color too."
problem: |
  A WebGL figure (nodes + additive glow halos + additive edge lines)
  looks great inside a dark panel. Reusing the same scene on a
  transparent canvas floating over a light page (#FAFAF9) renders the
  spheres but the edges and halos vanish.

  Cause: AdditiveBlending computes `backdrop + fragment`. On a dark
  backdrop (~0) the fragment color survives. On a near-white backdrop
  (~1) any addition clips toward pure white — visually
  indistinguishable from the background, i.e. invisible.

  A second, related trap: `scene.fog` tuned for the dark panel lerps
  distant objects toward the panel color. Over a light page that
  reads as muddy dark artifacts.
solution: |
  Branch the materials by backdrop, not by app theme alone:

  ```ts
  const onLight = variant === "ambient"; // transparent canvas over light page
  const edgeMat = new THREE.LineBasicMaterial({
    transparent: true,
    opacity: onLight ? 0.45 : 0.55,
    blending: onLight ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthWrite: false,
  });
  // glow halos: same switch, slightly lower opacity on light
  if (!onLight) {
    scene.fog = new THREE.Fog(DARK_PANEL_HEX, near, far);
  } // over a light page: omit fog, or fog toward the page color
  ```

  Rule of thumb: AdditiveBlending is a dark-backdrop technique.
  Anything meant to "glow" on light surfaces needs NormalBlending
  with alpha (or a different visual treatment entirely).
gotchas:
  - "The canvas being transparent (alpha: true, clearColor alpha 0) makes the PAGE the backdrop — the blend happens against whatever is behind the canvas, so a theme toggle changes the math under you."
  - "Highlight/dim interactions that lerp colors toward a 'background' color must use the page color (light: ~#FAFAF9, dark: ~#0A0A0F), not the removed panel color — otherwise hover-dim looks like dirt in light mode."
  - "Label sprites painted for dark panels (white text) are invisible over light pages for the same reason — ink color must follow the backdrop too."
last_validated_at: "2026-06-12"
---

## Symptom recognition

| Symptom | Likely cause |
|---|---|
| Spheres/meshes visible, lines/halos gone (light bg) | Additive blending saturating to white |
| Distant nodes look muddy/dark over a light page | Fog lerping toward an old dark panel color |
| Same scene fine in dark mode, broken in light | Backdrop-dependent blending; theme toggle changed the backdrop |

## Why additive saturates

Additive blending: `result = backdrop + fragment` (clamped to 1).
With backdrop ≈ (0.98, 0.98, 0.97), ANY fragment pushes the result
to ≈ 1.0 — pure white on near-white. The fragment's hue is lost.
On a dark backdrop the same addition produces the hue itself,
which is why the technique is a staple for dark-UI glow effects.

## Verification

Render the scene over both backdrops and diff the pixels — if the
light render is missing geometry that the dark render shows, the
blend mode is the cause:

```ts
// quick probe: force NormalBlending at runtime and re-render once
scene.traverse((o) => {
  const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
  if (mat && "blending" in mat) mat.blending = THREE.NormalBlending;
});
renderer.render(scene, camera);
// if the missing halos/edges appear now, port the materials properly
```

## When this does not apply

- Scenes rendered inside a permanently dark container (panel, hero,
  dark-only app): AdditiveBlending is the right tool there — do not
  blanket-replace it.
- Opaque canvases with their own clear color: the backdrop is the
  clear color, not the page; tune against that instead.

## Porting checklist (dark panel → light page)

1. Blending: Additive → Normal on every transparent material.
2. Opacity: re-tune (Normal usually needs slightly lower values).
3. Fog: remove, or re-color toward the page background.
4. Hover/dim lerp targets: page color per theme, not panel color.
5. Text/label sprites: ink color per backdrop.
6. Verify in BOTH themes — the backdrop, not the app theme, drives
   the math, and a transparent canvas inherits whichever page color
   is behind it.