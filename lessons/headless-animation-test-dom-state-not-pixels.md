---
id: lsn_headless_animation_test_dom_state_not_pixels
title: "Fix flaky headless animation checks — probe DOM state, byte-equal screenshots false-negative on subpixel raster"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [web]
  tags: [playwright, headless, testing, animation, screenshots, verification]
summary: "Verifying 'is it animating / is it static' by comparing two element screenshots with Buffer.equals is unreliable: scrolling, transforms and AA re-rasterize identical UI with subpixel differences, so 'static' content compares unequal (and a paused frame can compare equal mid-animation). Probe the DOM instead — sample the animated style/attribute (style.right, computed opacity, transform) at two instants and compare the VALUES."
problem: |
  A headless check asserts an element stopped (or started) animating:

  ```js
  const a = await el.screenshot();
  await page.waitForTimeout(800);
  const b = await el.screenshot();
  console.log("static:", a.equals(b));   // flaky!
  ```

  After a programmatic scroll the same resting UI rasterizes a few
  subpixels differently → false "still animating". The screenshot pipeline
  also rounds clip bounds per call. Pixel equality conflates "what it
  looks like" with "what state it is in".
solution: |
  Assert the state the animation actually drives:

  ```js
  const probe = () => page.evaluate(() => {
    const el = document.querySelector("#stage .winner");
    return {
      right: el?.style.right,                                  // framer writes inline
      opacity: getComputedStyle(el).opacity,
    };
  });
  const s1 = await probe();
  await page.waitForTimeout(800);
  const s2 = await probe();
  // static  ⇔ deep-equal; animating ⇔ values differ
  ```

  Reserve screenshots for LOOK verification (a human or visual-diff tool
  judges them); use value probes for BEHAVIOR verification (running,
  stopped, reached target).
gotchas:
  - "Transform-driven animations don't change layout boxes — probe style.transform / the library's inline style, not getBoundingClientRect alone."
  - "Sample-twice can hit a loop's identical phase (period ≈ sampling gap) — sample 3 points or use a non-divisor interval for loops."
  - "The inverse trap exists too: screenshots taken with animations: 'disabled' freeze CSS/WAAPI but not rAF/WebGL — a 'static' screenshot proves nothing about a canvas loop."
last_validated_at: "2026-06-12"
---

## Verification

Calibrate the probe against known states once:

```js
// 1. during a forced animation → values MUST differ
// 2. after prefers-reduced-motion (or animation end) → values MUST equal
```

If both calibration checks pass, the probe is trustworthy for CI use —
unlike pixel equality, which fails calibration step 2 after any scroll.

## When this does not apply

- True visual regression (colors, layout, fonts): screenshots with a
  tolerance-based differ are the right tool — just not Buffer.equals.
- Canvas/WebGL content with no DOM reflection: there is no style to
  probe; compare downscaled pixel hashes with a tolerance instead.

## Related

[[lsn_framer_svg_attr_keyframes_transform_group]] — the class of silent
animation failures that make behavior probes (not descriptions, not
single stills) mandatory.