---
id: lsn_react_effect_imperative_conditional_remount_deps
title: "Fix a ref-driven useEffect that stops working after a conditional re-mount — add the render condition to its deps"
type: debugging_lesson
tier: community
summary: "A useEffect that imperatively initializes DOM/SVG nodes captured by ref keeps operating on the OLD nodes after a render-condition flips. Switching which branch renders re-mounts the nodes, but the effect does not re-run unless that condition is in its dependency array — so the setup (e.g. an SVG stroke-dasharray, a canvas context, an observer) silently never applies to the new branch's nodes. Fix: add the render condition to the effect deps so it tears down and re-runs against the fresh refs."
context:
  tools: [react]
  languages: [typescript, javascript]
  platforms: []
  tags: [react, hooks, useeffect, refs, conditional-rendering, dependency-array]
---

## The symptom

A component renders two different element trees behind a condition, and an
effect imperatively drives the nodes via refs. After the condition flips, the
imperative behavior silently stops working on the now-rendered branch — even
though the same effect worked fine when that branch was the initial one.

A real case: an SVG "travelling light" set `stroke-dasharray` on path nodes
inside an effect. The component rendered a heavy full glow at first, then
switched to a `lite` branch (a different set of `<path>` nodes). On the lite
branch the dash never applied → the whole outline rendered SOLID instead of a
moving dashed segment. It looked like "the dash doesn't work on mobile," but the
dash code was fine — it was running against detached nodes.

```tsx
function Glow({ lite }: { lite: boolean }) {
  const aRef = useRef<SVGPathElement>(null);
  const bRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const a = aRef.current, b = bRef.current;
    if (!a || !b) return;
    // imperative setup on whichever nodes are mounted now
    applyDash(a); applyDash(b);
    const raf = requestAnimationFrame(/* … animate a/b … */);
    return () => cancelAnimationFrame(raf);
    // missing `lite` — effect won't re-run when the branch swaps
  }, [/* …other deps… */]);

  return lite
    ? (<><path ref={aRef}/><path ref={bRef}/></>)
    : (<g mask="url(#m)"><path ref={aRef}/><path ref={bRef}/><path/><path/></g>);
}
```

## Why it happens

The two branches are different positions in the element tree (`<>` vs a wrapping
`<g>`), so React **unmounts the old paths and mounts new ones** when `lite`
flips. React sets the refs to the new nodes. But the effect's closure captured
the OLD node references and, crucially, **does not re-run** because `lite` is not
in its dependency array. So the imperative setup (and any rAF loop / listeners)
keeps targeting the unmounted nodes; the freshly-mounted ones are never touched.

This is the *under-firing* sibling of the more familiar *over-firing* effect bug
— a cleanup effect with an unstable dep tearing a resource down every render
([[lsn_react_unmount_cleanup_unstable_dep]]). Same root discipline (deps must
reflect everything the effect reads), opposite failure: here the effect should
have re-run and didn't.

## The fix

Put the render condition in the deps so the effect tears down and re-runs against
the new refs:

```tsx
}, [/* …other deps…, */ lite]);
```

On the flip, cleanup cancels the old rAF/listeners and the re-run re-grabs
`aRef.current`/`bRef.current` (now the new nodes) and re-applies the setup.

If re-mounting is itself the problem (you want the nodes to persist across the
switch), the alternative is to **keep the nodes in a stable position** so they
are not re-created — e.g. render them in the same parent both times and toggle
only siblings/attributes. Then the effect's refs stay valid and you don't need
the condition in deps. Pick one: re-run on the condition, or don't re-mount.

## How to spot it

- An imperative/ref-driven effect "works on first render but not after a toggle."
- The toggled branches render the ref'd nodes under **different parents** (so
  React re-mounts them rather than reusing them).
- `react-hooks/exhaustive-deps` is silenced (an `eslint-disable` on the deps
  line) — re-check what the effect actually reads, including JSX-branch
  conditions that change which nodes its refs point at.

```text
search_lessons({ query: "useEffect ref stops after conditional remount", tools: ["react"] })
```

## When this does not apply

- The effect reads no refs / does no imperative DOM work (pure declarative React
  re-render handles branch swaps for you).
- The two branches reuse the **same** element identity (same type + position +
  key), so React updates rather than re-mounts — refs stay valid, no re-run
  needed.
- You intentionally want a long-lived resource to survive the toggle: stabilize
  the nodes instead (see the fix's alternative), don't add the dep.
