---
id: lsn_drag_reorder_commit_on_drop
title: "Fix a hand-rolled drag-to-reorder that jitters, jumps, and scrambles — commit on drop, not mid-drag"
type: debugging_lesson
tier: community
summary: >
  In a hand-rolled drag-to-reorder list, mutating the data array on every crossed
  midpoint DURING the drag — while the dragged element's transform uses an absolute
  translation from the press point — makes the item jump by a row height, decouple
  from the pointer, and oscillate. Keep the array stable during the drag, track only
  a target index and open a visual gap, then commit the reordered array once on drop.
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [react-native, web]
  tags: [drag-and-drop, reorder, gestures, animation, state-management]
---

## Symptom

A custom (non-library) drag-to-reorder list where, mid-drag, rows jitter, jump by a
full row height, lose the pointer, and the order scrambles into items you never
touched. Looks like "the gesture engine is fighting itself."

## Root causes (they compound)

This bug class appears when the list **reorders its data array live, on every crossed
midpoint**, instead of on drop. Four mechanisms stack:

1. **Live reorder + absolute translate = jump.** The dragged element is positioned with
   `translateY = (pointerY - pressY)` (absolute delta from the press point). The moment
   the array reorders, the dragged row's layout slot shifts by ~one row height, but the
   delta is unchanged — so the card jumps a full row and detaches from the cursor.
2. **Frozen closure index → wrong splices.** On web, a `mousemove`/`pointermove` listener
   attached to `document` on press captures the *start* index and the *then-current*
   reorder callback. After the first reorder the dragged item has moved, but the listener
   keeps calling `onMove(startIndex, …)`, so subsequent `splice(startIndex, …)` removes a
   *bystander* row. The list scrambles.
3. **Threshold overshoot → oscillation.** After committing a swap, the dragged midpoint is
   recomputed against the *new* slot while the delta is unchanged, so the swap threshold is
   immediately re-crossed → swap back → swap forward, every frame. That is the visible
   "jitter."
4. **State storm + stale measurements.** Two state updates per move (reorder + active-index)
   re-render the whole list mid-gesture; an index-keyed layout cache is re-measured racily
   after each reorder, feeding wrong positions back into the target computation.

**Symptom → cause quick map:**

| Symptom | Cause |
|---|---|
| Card jumps one row and detaches from cursor on first crossing | 1 (live reorder + absolute delta) |
| Unrelated rows get shuffled after the first move | 2 (frozen closure index) |
| Rapid back-and-forth flicker near a boundary | 3 (threshold overshoot, no dead-band) |
| Lag / focus loss / wrong target slot | 4 (state storm + stale index-keyed layouts) |

## The fix: commit-on-drop

Keep the **data array stable for the entire drag**. During the drag, compute only a
*target index* (where the item would land) and move neighbours visually to open a gap.
Write the reordered array exactly **once, in the drop handler**.

```
onDragStart(i):   draggingIdx = i; targetIdx = i        // snapshot, no data change
onDragMove(i,dy): targetIdx = slotCrossedBy(measured[i].mid + dy)   // compute only
onDragEnd():      if (targetIdx !== draggingIdx) commit(splice/insert) once
```

Why this removes all four causes *by construction*:

- No slot reflow during the drag → the dragged element's absolute delta stays valid → **no jump** (cause 1).
- The dragged row's index never changes mid-drag → the frozen closure index is now correct → **no wrong splice** (cause 2).
- Layouts are fixed and the dragged midpoint is monotonic in the delta → **no feedback loop**; add a small dead-band (a few px) around each midpoint to kill boundary flicker (cause 3).
- At most one state update per move (target changed) instead of two per crossing (cause 4).

For the gap, animate non-dragged rows by ±rowPitch with a short timing animation; the
dragged row keeps following the pointer. The dead-band value and timing duration are taste;
the **commit-on-drop boundary** is the load-bearing decision. The principle generalizes
beyond vertical lists (grids, kanban columns): never mutate the source collection while the
pointer still owns an absolute offset into the old layout.

## Gotchas

- **Key by stable id, not array index.** With index keys the animated instance stays with
  the *slot*, so the lifted element's transform jumps to whatever row now occupies that
  position. Stable keys make the instance follow the item.
- **Measure the row *pitch*, not just height.** The gap size is the row-to-row distance
  (height + margin). Derive it from adjacent measured `y` offsets, not from a single row's
  measured height (margins are excluded from layout height).
- **Read live values from a ref inside long-lived listeners.** A `document`-level
  pointer-move listener added on press will use stale closure values; if you must reorder
  live, read the current index/callback from a ref. (Commit-on-drop sidesteps this entirely
  because the index does not change mid-drag.)
- **Don't reach for a heavy DnD/animation library just to fix this** on cross-platform web —
  the architecture (deferred commit) is the fix, and some animation stacks are themselves
  unstable on web (see [[lsn_reanimated_svg_web_instability]]). A few animated values or CSS
  transforms are enough.

## When this does NOT apply

- **You use a mature DnD library** (e.g. a drag-enabled list component) — those already
  defer the commit and manage the gap; this convention is for when you own the gesture loop.
- **Reorder is delegated to the OS / a native list** rather than hand-tracked.
- **No drag at all** — e.g. up/down arrow buttons. Then there is no gesture loop to get wrong.

Related: [[lsn_reanimated_svg_web_instability]] (why not to lean on Reanimated on web),
[[lsn_modal_vertical_centering_state_jump]] (another state-change layout-jump in UIs).
Find this via `search_lessons({ query: "drag reorder jitter jump", platforms: ["react-native", "web"] })`.