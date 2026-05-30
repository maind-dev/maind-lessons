---
id: lsn_modal_vertical_centering_state_jump
title: "Modal jumps vertically on state-change — anchor multi-state modals to viewport-top, not flex center"
class: lesson
type: workflow_best_practice
tier: community
context:
  tools: []
  languages:
    - typescript
    - javascript
  platforms:
    - web
  tags:
    - modal
    - dialog
    - css
    - ux
    - state-machine
last_validated_at: "2026-05-29"
summary: |
  Modals positioned via flex items-center re-center on every content-height change. Multi-state modals visibly jump on each transition. Use items-start + fixed top padding for state-driven modals.
---

The standard modal pattern wraps the modal box in a fixed-positioned flex container with `items-center justify-center`, which centers the modal both horizontally and vertically in the viewport. This works perfectly when the modal's content height is stable (one form, one confirmation prompt). It breaks visibly when the modal cycles through states whose content height varies significantly.

Concrete example: a multi-step 2FA enrollment modal cycling through:

- `idle`: Avatar + 2 factor tiles + footer = ~520 px tall
- `enrolling_passkey`: Avatar + device-name input + buttons = ~360 px tall
- `success_passkey`: Avatar + CheckCircle + caption = ~280 px tall
- `done`: Avatar + 2 active-status tiles + Continue button = ~440 px tall

On each state transition, vertical centering recomputes the modal's viewport position. Modal-top moves down/up by half the height delta. Result: the entire modal visibly jumps each time the user does anything. The CheckCircle animation that should feel triumphant feels janky.

## Why it surprises developers

`items-center` is the right default for *most* modals. The state-jump problem only surfaces when the modal has multiple substantially-different content states. Single-purpose modals (confirm delete, edit one record, enter password) don't trigger it. The bug stays hidden until you build a multi-step wizard, then suddenly every state transition feels wrong without any obvious CSS cause.

The instinct to fix it with animation (CSS `transition: top` on the modal box) doesn't help — the modal is fixed-positioned inside a flex container, the position change is happening at the flex layout level, not at the modal-box level. You can transition the modal's own properties but not the flex centering.

## The fix: top-anchor + fixed offset

Replace `items-center` with `items-start` and add a fixed top padding on the flex wrapper. The modal's top edge is now at viewport-top + padding, invariant of content height. Content extending beyond the padded area is handled by the modal's own `overflow-y-auto` (scrolling within the modal, not via repositioning).

```tsx
// Before (jumps on state change):
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
  <div className="modal-box max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto ...">
    {/* content varies by state */}
  </div>
</div>

// After (stable, top-anchored):
<div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-8 sm:pt-16">
  <div className="modal-box max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto ...">
    {/* content varies by state — modal-top stays put */}
  </div>
</div>
```

The `pt-8 sm:pt-16` (32 px mobile, 64 px desktop) is a sensible default — comparable to where Vercel/GitHub anchor their account-settings modals.

## Make it a Dialog-Primitive prop, and the diagnostic trap

In a project with 10+ Dialog instances, don't hard-code the alignment per consumer. Add a `vAlign?: "center" | "top"` prop; default `center` keeps existing consumers unchanged, only multi-state modals opt into `top`:

```tsx
const wrapperAlignment =
  vAlign === "top" ? "items-start pt-8 sm:pt-16" : "items-center";

return (
  <div className={`fixed inset-0 z-50 flex justify-center bg-black/60 px-4 ${wrapperAlignment}`}>
    {/* ... */}
  </div>
);
```

**The diagnostic trap that follows:** after wiring `vAlign="top"`, someone reports "the anchor isn't working, the modal still looks centered." The reflex is to hunt for a CSS bug — stale build, specificity override, a `transform`/`filter` ancestor that re-bases the `fixed` overlay's containing block. In practice the anchor is almost always applied correctly and the perception is the real issue. Two checks before touching CSS:

1. **It's the modal's height, not the anchor.** A tall modal (e.g. a 240 px avatar/orbit header pushing total height to ~600 px) on a ~800 px laptop viewport sits with its top edge at the padding offset — but because it fills most of the viewport, top-anchored and centered look nearly identical. Maximize the window or shorten the content and the anchor becomes obvious. The give-away that the anchor IS working: the top edge stays put across state transitions; only the bottom edge moves.

2. **You're inspecting the wrong element.** The alignment classes live on the OUTER flex wrapper (`fixed inset-0 flex justify-center …`), not on the inner `<div role="dialog">` box. DevTools-inspecting the dialog element and not finding `items-start` is expected — look one level up.

**A zero-DevTools proof the anchor is live:** `justify-center` (horizontal) and `align-items: flex-start` (vertical) sit on the *same* flex container. If horizontal centering visibly works, the vertical top-alignment is necessarily also in effect — the browser cannot honor one axis and silently drop the other. So if the modal is horizontally centered at all, the top-anchor is active by construction; the remaining question is purely perceptual (height), not CSS. This collapses a multi-hypothesis "why doesn't my class apply" hunt into a one-line logical check.

## When to use which

| Modal kind | vAlign |
|---|---|
| Confirm delete / single-step confirm | center |
| Edit-one-record form | center |
| Enter password / single-field prompt | center |
| Multi-step wizard | **top** |
| Success-flash after user action | **top** |
| Inline state-machine modal (idle → loading → success) | **top** |
| Image lightbox / single-shot preview | center |

The heuristic: if the modal's visible content changes height by more than ~100 px during its lifecycle, use `top`. Otherwise `center`.

## Why this is worth knowing

The state-jump bug isn't visible in static design mocks (which show only one state at a time), isn't visible in storybook (where you mount each state separately), and isn't visible in unit tests. It only manifests during an actual end-to-end user flow that walks through the states. By the time a designer or PM notices, the modal has shipped. The fix is trivial (one prop) but the framing (state-driven → top, stable → center), plus the perceptual-not-CSS diagnostic, is what makes the decision repeatable.