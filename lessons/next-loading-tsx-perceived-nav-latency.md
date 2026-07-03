---
id: lsn_next_loading_tsx_perceived_nav_latency
title: "Add `loading.tsx` so App Router tab-switches feel instant — the shared layout does NOT re-fetch on soft nav"
type: workflow_best_practice
tier: community
lesson_class: architecture
quality_tier: experimental
context:
  tools: []
  languages: [typescript]
  platforms: [nextjs]
  tags: [nextjs, app-router, loading-tsx, suspense, perceived-latency, partial-rendering, navigation]
summary: "Without a `loading.tsx` (or Suspense boundary) in an App Router segment, a client navigation to a dynamic route blocks on the full server render before anything new paints — the UI looks frozen on the old tab. Add `loading.tsx`: the shared layout stays put and a skeleton shows instantly. Companion fact correcting a common misconception: the shared layout does NOT re-fetch its data on soft sibling navigation (partial rendering preserves it) — per-tab cost is the page render plus middleware."
last_validated_at: "2026-06-01"
---

## The frozen-tab symptom

A dynamic App Router route (anything using cookies/auth, or `force-dynamic`) is re-rendered on the server on every navigation. With no `loading.tsx` and no Suspense boundary in that segment, the router waits for the entire server render to finish before swapping content — so after a click the UI sits on the *old* tab with no feedback. Users read this as "slow", even when the actual render is sub-second.

## The fix: loading.tsx

Add a `loading.tsx` to the segment (or a group layout that covers many routes). It renders instantly as the navigation starts, while the real page streams in behind it:

```tsx
// app/(app)/loading.tsx — covers every route under (app)
export default function Loading() {
  return <DashboardSkeleton />; // header bar + card placeholders matching the page shape
}
```

Because a shared layout is preserved across navigation, the sidebar/shell stays mounted and only the content slot shows the skeleton — exactly the "instant" feel you want. Route-specific `loading.tsx` files override the generic one where a tab's shape differs a lot.

## The misconception that misdirects optimization

A common (and wrong) mental model — even capable agents assert it — is "the shared layout re-runs all its data fetching on every tab switch, so that's why it's slow." It does not. App Router **partial rendering** preserves the shared layout across soft sibling navigations; only the changed page segment re-renders on the server. The layout's queries run on initial load and hard refreshes, not per soft tab-switch.

So when you profile perceived tab-switch latency, look at: (1) missing `loading.tsx` (the feedback gap), (2) the destination page's own dynamic render + queries, and (3) middleware that runs on every navigation (including RSC fetches). Do not "optimize" the layout's per-switch cost — it largely is not paying one.

## When this does not apply

- Fully static / prerendered routes already paint instantly — `loading.tsx` adds little.
- If the real win is below-the-fold data, a targeted `<Suspense>` around the slow subtree streams better than a whole-page skeleton.

## Related

Find this from a symptom: `search_lessons({ query: "next app router loading.tsx perceived latency partial rendering layout", platforms: ["nextjs"] })`. Sibling Suspense trap: [[lsn_next_search_params_suspense_bailout]].
