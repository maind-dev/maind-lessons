---
id: lsn_next_view_transitions_directional_page_slide
title: "Fix non-reversing back-nav and 3 more next-view-transitions traps (Next.js App Router page slides)"
type: debugging_lesson
tier: community
summary: "next-view-transitions (Next.js App Router) vertical page slides hit four traps: (1) no forward/back direction — set data-vt-direction on <html> at navigation start, never on a timer; (2) transition `root`, not a tall named <main> (a named element snapshots its full height → translateY(-100%) slides the whole page); (3) keep nav/footer static by giving THEM a view-transition-name; (4) ::view-transition-* rules are an HMR blind spot — restart the dev server."
context:
  tools: [nextjs]
  languages: [typescript, css]
  platforms: [nextjs, web]
  tags: [nextjs, app-router, view-transitions, next-view-transitions, css, animation]
last_validated_at: "2026-06-21"
version: 1
---

A vertical page transition — clicking an internal link slides the current view and the new page scrolls into place, browser-back reversing it (the elevenlabs.io/flows feel) — is straightforward with `next-view-transitions` (a thin wrapper over `document.startViewTransition`). With a persistent App Router layout (nav + `<main>{children}` + footer that never unmount) it is the production-safe choice — Next 16's `experimental.viewTransition` is explicitly "not recommended for production". Four things bite that aren't in the README.

## 1. The library has NO direction — set it at navigation START

`next-view-transitions` animates forward navigations (its `<Link>`) AND browser back/forward (it registers its own internal `popstate` handler). But it never tells you which way you went, so one set of `::view-transition-*` keyframes plays for both → back doesn't reverse.

Drive direction with an attribute on `<html>` + attribute-scoped keyframes:

```tsx
// transition-aware <Link> wrapper onClick (runs before the library navigates):
document.documentElement.dataset.vtDirection = "forward";

// a tiny client component mounted once in the layout:
useEffect(() => {
  const onPop = () => { document.documentElement.dataset.vtDirection = "back"; };
  window.addEventListener("popstate", onPop);
  return () => window.removeEventListener("popstate", onPop);
}, []);
```

```css
::view-transition-old(root) { animation: slide-down-out 800ms var(--ease); }  /* forward */
::view-transition-new(root) { animation: slide-down-in  800ms var(--ease); }
[data-vt-direction="back"]::view-transition-old(root) { animation: slide-up-out 800ms var(--ease); }
[data-vt-direction="back"]::view-transition-new(root) { animation: slide-up-in  800ms var(--ease); }
```

**Set the attribute at navigation start, never reset it on a timer.** The tempting "reset to forward after the back transition" via `requestAnimationFrame` flips the attribute MID-ANIMATION → the matched rule changes → the keyframes swap and the slide jumps. Every forward `<Link>` click already re-sets it to `"forward"`, so it stays correct with zero resetting.

## 2. Transition `root`, NOT a tall named `<main>`

To exclude nav/footer you might name `<main>` and slide only that. Don't: a named element is snapshotted at its FULL rendered size. A `<main>` holding a multi-viewport page becomes a snapshot several screens tall, so `translateY(-100%)` slides the entire page height — wildly overshooting. The default `root` snapshot is **viewport-clipped**, so `translateY(-100%)` moves exactly one screen — the real "scroll to the next page".

## 3. Keep nav/footer static by naming THEM

Because `root` carries everything, a sticky header slides away with the old page (unsmooth). Fix it the OPPOSITE way to #2: give the nav (and footer) its own `view-transition-name`, which lifts it OUT of `root` into its own group. With a persistent layout the old/new nav snapshots share a position, so that group holds still while `root` (= viewport minus the named elements) slides under it.

```css
.site-nav { view-transition-name: site-nav; }  /* header stays put; content scrolls under it */
```

`view-transition-name` must be a unique custom-ident per document.

## 4. `::view-transition-*` rules are an HMR blind spot

Editing `::view-transition-old/new(root)` and still seeing the OLD animation is the #1 false alarm. These pseudo-elements exist only DURING a transition, so dev-server CSS hot-reload frequently does not apply changes to them — you keep testing stale CSS. **Restart the dev server** (a hard-refresh is often not enough). Quick check: in DevTools confirm the live `::view-transition-new(root)` references your current keyframe name. Reduced-motion also still cross-fades (the library calls `startViewTransition` regardless), so explicitly kill it: `@media (prefers-reduced-motion: reduce) { ::view-transition-group(root), ::view-transition-old(root), ::view-transition-new(root) { animation: none !important; } }`.

## When this does NOT apply

- Cross-document (MPA) transitions via pure CSS `@view-transition { navigation: auto }` are simpler and dependency-free, but force full-document navigations — wrong for an SPA with a persistent, animation-heavy layout (every navigation re-runs mount animations).
- Without a persistent layout, naming nav/footer is unnecessary; `root` already carries everything.
- Browsers without the View Transitions API need nothing — the library degrades to an instant navigation and the pseudos are never created.

Retrieve before building: `search_lessons({ query: "next-view-transitions page slide direction", platforms: ["nextjs"] })`.
