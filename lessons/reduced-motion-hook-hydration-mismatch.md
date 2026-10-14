---
id: lsn_reduced_motion_hook_hydration_mismatch
title: "Fix reduced-motion hydration mismatches — read the media query via useSyncExternalStore with a false server snapshot"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript]
  platforms: [nextjs, web]
  tags: [product-demo, react, hydration, ssr, reduced-motion, framer-motion]
summary: "Components that branch on prefers-reduced-motion during render hydrate wrongly for every visitor who has it set: hooks like framer-motion's useReducedMotion read matchMedia in the first client render, while the server rendered the motion branch. Read the query through useSyncExternalStore with a server snapshot of false, remount hidden-start components with a key, and fix every call site at once."
last_validated_at: "2026-10-13"
---

## Symptom

Only visitors with "reduce motion" enabled (macOS, iOS, Windows accessibility settings) see it: a hydration error in the console, a flash, text that renders twice or not at all, an animated section that stays invisible. Everyone else — including you, testing with default settings — sees a clean page. Fix one component and the next one reports the same error.

## Cause

The server cannot know the visitor's media preferences, so it renders the default branch (`reduced = false`). Hooks such as framer-motion's `useReducedMotion()` read `window.matchMedia("(prefers-reduced-motion: reduce)")` synchronously, so the **first** client render — the one React hydrates against the server HTML — already sees `true` and renders the static branch. Markup differs, hydration fails.

Two properties make it expensive to chase:

- **React reports only the first mismatch of a page.** The other components with the same bug stay silent until the first one is fixed. Expect a long tail, and sweep every call site at once instead of fixing what the console shows.
- **Hydration does not patch attributes.** Where only an attribute differs (an `<img src>` picked from the preference, a `data-state`), React keeps the server's value and warns; the page silently shows the wrong variant.

## Fix

Read the preference through a hook whose server snapshot is `false`. During hydration React uses the server snapshot, so the first client render matches the HTML; right after, it re-renders with the real value.

```ts
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useHydratedReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches, // client
    () => false,                            // server AND hydration
  );
}
```

Then replace every direct `useReducedMotion()` (or hand-rolled `matchMedia` in render) with it — a codemod or a lint rule that bans the original import keeps it from coming back.

**Components that start hidden need a remount.** An entrance animation (`initial={{ opacity: 0 }}`, revealed on scroll) hydrates in its hidden motion state; when the hook flips to `true` a moment later, the static branch expects it visible but the animation library already applied `initial`. Key the subtree on the mode so it mounts fresh:

```tsx
const reduced = useHydratedReducedMotion();
return <Reveal key={reduced ? "static" : "motion"} animate={!reduced} />;
```

The same pattern fixes the attribute case: choose the client-only variant after mount and apply it with `key`, so React creates the element instead of patching it.

## Verification

Load every page with the preference emulated and count hydration errors — twice, because the second load catches cached-chunk timing differences:

```js
await cdp.send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
// navigate, collect console errors matching /hydrat/i, expect 0
```

Then scroll each page and check that no element is left at `opacity: 0`. Compare against a build without the change if unsure which hidden elements are intentional.

## When NOT to use this

- Motion that CSS alone can switch off (`@media (prefers-reduced-motion: reduce) { … }`) — no render branch, nothing to mismatch; prefer it.
- Components rendered client-only (`dynamic(..., { ssr: false })`) — there is no server HTML to disagree with, so the synchronous hook is fine.
- Other non-deterministic render values (dates, random ids) have their own fixes: [[lsn_ssr_nondeterministic_value_hydration]].

Related search: `search_lessons({ query: "hydration mismatch reduced motion matchMedia", platforms: ["nextjs"] })`.
