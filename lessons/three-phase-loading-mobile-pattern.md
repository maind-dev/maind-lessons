---
id: lsn_three_phase_loading_mobile_pattern
title: Use a three-phase loading pattern in mobile apps — skeleton, cached, fresh — to make every screen feel instant
type: workflow_best_practice
tier: community
lesson_class: architecture
quality_tier: hand-vetted
context:
  tools:
    - react-native
    - expo
    - react
  languages:
    - typescript
  platforms:
    - ios
    - android
  tags:
    - loading-states
    - mobile-ux
    - caching
    - perceived-performance
summary: >-
  Mobile screens that wait for a network roundtrip before rendering
  feel sluggish — even at 200ms. A three-phase pattern (skeleton →
  cached data → fresh data) makes every navigation feel instant.
  Phase 1: render a skeleton on mount. Phase 2: replace with whatever
  is in the cache (even if stale). Phase 3: silently revalidate and
  swap in fresh data when it arrives. Cache invalidation is per-entity,
  not global.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The problem

A typical mobile screen does this:

```
[tap nav] → loading spinner (300-800ms) → screen renders
```

Even fast networks feel slow because the user sees a blank state.
Slow networks feel broken. Worse: when the data hasn't changed since
last view, the user is waiting for nothing — the cached version was
already correct.

## The pattern

```
[tap nav]
   ↓
Phase 1 — render skeleton immediately (0ms)
   ↓
Phase 2 — replace with cached data, if any (typically <50ms)
   ↓
Phase 3 — kick off network fetch in background
   ↓
Phase 3' — swap to fresh data when it arrives (typically 100-800ms)
```

The user never sees a blank screen, and the screen is usable from
roughly the moment they tap. On repeat visits where the data hasn't
changed, phase 3 completes silently — the user sees no transition
at all.

## Implementation sketch

The three phases are three render states from a single hook:

```typescript
function useScreenData(key: string) {
  const cached = readCache(key);                 // synchronous
  const [data, setData] = useState(cached);
  const [phase, setPhase] = useState<"skeleton" | "cached" | "fresh">(
    cached ? "cached" : "skeleton",
  );

  useEffect(() => {
    let cancelled = false;
    fetchFresh(key).then((fresh) => {
      if (cancelled) return;
      writeCache(key, fresh);
      setData(fresh);
      setPhase("fresh");
    });
    return () => { cancelled = true; };
  }, [key]);

  return { data, phase };
}
```

Render:

```typescript
const { data, phase } = useScreenData(`/profile/${userId}`);
if (phase === "skeleton") return <ProfileSkeleton />;
return <ProfileView data={data!} stale={phase === "cached"} />;
```

The `stale` prop lets the view render a subtle indicator (a faded
dot, a pull-to-refresh hint) so the user knows fresh data is on the
way. Don't block the UI on it.

## Cache shape and invalidation

The cache key must be entity-specific, not global:

- ✅ `cache.set("/profile/" + userId, data)` — invalidates one profile
- ❌ `cache.set("profile", data)` — invalidates everyone's profile

Common invalidation triggers:

- **On mutation.** After a successful POST/PATCH/DELETE on entity X,
  drop the cache entry for X. Phase 3 will rehydrate on next view.
- **On TTL.** Stale-after-30-seconds for fast-changing data, hours
  for slow-changing.
- **On app foreground.** When the app comes back from background,
  treat all visible-screen caches as stale and refetch.

For React Native specifically: persist the cache to AsyncStorage or
MMKV so phase 2 survives app restarts. The cold-start "skeleton →
cached" transition is one of the biggest UX wins of this pattern.

## When this does not apply

- **First-ever app launch.** No cache to read; phase 2 doesn't exist.
  Skeleton straight to fresh.
- **Strongly-consistent reads.** If the user just submitted a form
  and the next screen must reflect that state, skip the cached
  phase — `phase === "cached"` here would show stale data the user
  thinks they just fixed. Either invalidate the cache before
  navigating, or read directly from a local optimistic-update store.
- **Streaming / realtime data.** WebSocket-driven views have their
  own pattern (subscribe-and-render). The three-phase pattern is for
  pull-based REST/RPC reads.
- **Web with HTTP caching.** Browsers already cache aggressively via
  ETag/Last-Modified. Three-phase is most valuable on mobile, where
  the network stack doesn't do this for you.

## Verification

Two qualitative checks any product person can run:

1. **Time-to-first-paint.** Tap a nav item with a previously-visited
   screen. The screen content should appear within ~50ms (your
   AsyncStorage/MMKV read latency). If you still see a spinner, phase
   2 isn't wired or the cache is empty.
2. **No flash of empty state.** When fresh data arrives, the
   transition from cached to fresh should be a content update, not
   an unmount-and-remount. Watch for jank: if the view "flickers"
   when fresh lands, the swap is happening at the wrong level.

For instrumentation, log the three transitions:

```typescript
console.log(`[screen-data] phase: ${phase}, age_ms: ${Date.now() - cachedAt}`);
```

In production logs, the ratio of "fresh-only" (no cached phase) to
"cached-then-fresh" tells you how often the pattern is actually
saving the user a roundtrip.
