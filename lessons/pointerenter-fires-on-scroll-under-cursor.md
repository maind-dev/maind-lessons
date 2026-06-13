---
id: lsn_pointerenter_fires_on_scroll_under_cursor
title: "Fix hover animations that self-trigger while scrolling — pointerenter fires when content scrolls under a resting cursor"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [web]
  tags: [pointer-events, pointerenter, scroll, hover, ux, animation-triggers]
summary: "Browsers dispatch pointerenter/mouseenter when an element moves UNDER a stationary cursor — including during scroll. A 'replay on hover' bound to pointerenter therefore restarts whenever the visitor scrolls the section beneath their resting mouse, reading as a glitchy unprompted re-animation. Gate hover-triggered effects on accumulated pointermove DELTA (deliberate motion) instead of enter events."
problem: |
  An animation replays "on hover":

  ```tsx
  <div onPointerEnter={replay}>…stage…</div>
  ```

  Visitors report the animation "randomly restarts" or elements "flash
  back" while reading. Cause: they scroll with the mouse resting over the
  page; when the stage scrolls under the cursor, the browser synthesizes
  boundary events (pointerenter) exactly as if the user had moved the
  mouse in — and the replay fires without any deliberate hover.
solution: |
  Require real, deliberate pointer movement: accumulate pointermove delta
  and trigger only past a threshold; reset on leave.

  ```tsx
  const last = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(0);
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = last.current;
    last.current = { x: e.clientX, y: e.clientY };
    if (!prev) return;
    moved.current += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
    if (moved.current > 40) {        // deliberate motion, not a casual graze
      moved.current = 0;
      replay();
    }
  };
  <div onPointerMove={onPointerMove}
       onPointerLeave={() => { last.current = null; moved.current = 0; }}>
  ```

  Scrolling under a resting cursor produces no (or zero-delta) move
  events — no replay. Add a cooldown after each run so the finished pose
  can stand before a replay is allowed.
gotchas:
  - "Chromium also synthesizes mousemove after scroll to refresh hover states — with the SAME coordinates, so a delta gate filters it; a bare 'any pointermove' gate does not."
  - "Pick the threshold by element size: large stages warrant 30–50px so brushing across on the way to a button doesn't restart them."
  - "The same scroll-under-cursor behavior breaks CSS :hover-bound autoplay too — the fix concept (deliberate-motion gating) is JS-only."
last_validated_at: "2026-06-12"
---

## Verification

```js
// park the cursor over the element, then scroll the page programmatically
element.addEventListener("pointerenter", () => console.log("enter (scroll!)"));
window.scrollBy(0, 300); setTimeout(() => window.scrollBy(0, -300), 300);
// console shows "enter" without any mouse motion → the trap is live
```

After the delta-gate: probe a state marker (e.g. the animation's
key/progress) before and after the same scroll — it must not change.

## When this does not apply

- Effects that SHOULD react to mere presence (tooltips, cursors,
  spotlight follow): pointerenter is correct there.
- Touch: there is no hover; gate replays behind taps instead.