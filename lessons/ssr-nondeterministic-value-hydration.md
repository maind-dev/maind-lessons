---
id: lsn_ssr_nondeterministic_value_hydration
title: "Fix React hydration mismatches from Math.random/Date.now in render — derive from a stable seed"
type: debugging_lesson
tier: community
lesson_class: architecture
summary: "Calling Math.random(), Date.now() or new Date() in a component's render path produces different output on the server and on the client, triggering a React hydration mismatch: a flash, console warnings, and the server-rendered subtree thrown away. Fix by deriving the value deterministically from a stable key (hash an id/name), or by deferring genuinely dynamic values to a client-only useEffect."
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [nextjs, web]
  tags: [react, nextjs, ssr, hydration, determinism]
---

## How it surfaces

```tsx
// Render path computes a fresh random on every call
function Skeleton() {
  const width = 40 + Math.random() * 50; // server: 73%, client: 51%
  return <span style={{ width: `${width}%` }} />;
}
```

The server renders one value into the HTML; the client computes a different value on
hydration. React (18/19) detects the mismatch, discards the server HTML for that
subtree and re-renders on the client — you get a flash, a console warning
("Hydration failed because the server rendered HTML didn't match the client"), and any
server-rendered content in that subtree is thrown away. The same applies to
`Date.now()`, `new Date()`, `performance.now()`, and random IDs generated in render.

## Fix 1 — derive from a stable seed (preferred for render-time values)

If the value should be identical on both sides, compute it deterministically from a key
you already have (an id, a name, an index):

```tsx
// Tiny FNV/LCG hash → stable pseudo-random, identical server and client
function seeded(seed: string, n: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = (h ^ seed.charCodeAt(i)) * 16777619;
  const out: number[] = [];
  for (let i = 0; i < n; i++) { h = (h * 1103515245 + 12345) & 0x7fffffff; out.push(40 + (h % 50)); }
  return out;
}
const widths = seeded(item.id, 5); // same on server and client
```

## Fix 2 — defer to the client (for genuinely dynamic values)

If the value is inherently client-only (current time, real randomness), do not render it
on the server — compute it in `useEffect` after mount:

```tsx
const [now, setNow] = useState<string | null>(null);
useEffect(() => setNow(new Date().toLocaleTimeString()), []);
return <span>{now ?? ""}</span>; // server renders empty, client fills in
```

For the narrow case of needing stable unique IDs across SSR, React's `useId()` is the
purpose-built tool.

## Last resort — suppressHydrationWarning

`<time suppressHydrationWarning>` silences the warning for a single element whose
mismatch is expected and harmless (a timestamp). It does NOT fix the mismatch — it only
suppresses the log for that one node. Never blanket it over a subtree.

## When this does NOT apply

- Non-deterministic values *outside* the render path (event handlers, effects) never
  reach SSR — `onClick={() => Math.random()}` is fine.
- Fully client-rendered trees (`dynamic({ ssr: false })`, see
  [[lsn_next_dynamic_ssr_false_client_only]]) have no server pass to mismatch — but you
  pay the no-SSR cost.

## Detection

The browser console shows the mismatch on first load. To catch it before shipping, do a
production build and load the route, or grep render paths:

```bash
rg "Math\.random|Date\.now|new Date\(\)|performance\.now" src/ --type tsx
# Each hit inside a component body (not in an effect/handler) is a candidate.
```