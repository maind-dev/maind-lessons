---
id: lsn_nextjs_revalidate_page_level_only
title: "Fix stale ISR data — `export const revalidate` works only in page/layout files, components are silently ignored"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript]
  platforms: [nextjs]
  tags: [nextjs, app-router, isr, revalidate, server-components]
summary: "In the Next.js App Router, `export const revalidate` is a route-segment config — it is read ONLY from page.tsx, layout.tsx and route.ts. Exporting it from a section/component file compiles fine, typechecks fine, and is silently ignored: the route stays fully static and data updates only on redeploy. Declare it in the page (or layout) of every route whose components fetch."
problem: |
  A server component (e.g. a section fetching CMS/changelog entries
  from a database) exports its own revalidation interval:

  ```ts
  // components/sections/ChangelogTimeline.tsx
  export const revalidate = 60; // ← silently ignored
  export async function ChangelogTimeline() {
    const entries = await getChangelogEntries();
    ...
  }
  ```

  Build output still marks the route as fully static (no revalidate
  column). New rows appear on localhost (dev renders per request)
  but never in production — a classic "works in dev, stale in prod"
  report. Nothing warns: the export is legal TypeScript, it's just
  not a file Next reads segment config from.
solution: |
  Move (or duplicate) the export into the route's page.tsx — and
  leave a comment so the next person doesn't "clean it up":

  ```ts
  // app/page.tsx
  // ISR: <Section> fetches from the DB. Segment config is only read
  // from page/layout/route files — a component-level export is
  // silently ignored and the page would stay fully static.
  export const revalidate = 60;
  ```

  Then verify in the build's route table that the route shows the
  revalidate interval instead of plain static.
gotchas:
  - "No error, no warning, no lint — the only signal is the build route table (and stale production data)."
  - "Dev mode hides the bug completely: `next dev` renders every request fresh, so the data always looks live locally."
  - "If a layout fetches the same data for a nav element, the layout's segment config doesn't cover other routes' pages — each route that needs ISR declares it in its own page/layout chain."
last_validated_at: "2026-06-12"
---

## Verification

After `next build`, read the route table:

```
Route (app)                    Revalidate  Expire
┌ ○ /                                  1m      1y   ← ISR active
├ ○ /about                                          ← fully static
```

If the route whose component fetches shows no revalidate value,
the export is being ignored — check WHICH file declares it.

```bash
# find misplaced revalidate exports outside page/layout/route files
grep -rn "export const revalidate" src/components/
```

Any hit in `src/components/**` is a candidate for this bug.

## Why Next behaves this way

Segment config (`revalidate`, `dynamic`, `fetchCache`, ...) is
statically analyzed per route segment. Components are not route
segments — they can be imported by many routes with conflicting
needs, so the compiler ignores config exports outside
`page|layout|route|template` files rather than guessing.

## When this does not apply

- `fetch()` calls with `next: { revalidate: N }` work anywhere —
  the per-fetch option is not segment config. The trap is specific
  to the module-level `export const revalidate`.
- Pages Router (`getStaticProps`'s `revalidate`) has different
  mechanics entirely.

## Related

[[lsn_next_dynamic_ssr_false_client_only]] — same family of App
Router rules that typecheck fine and fail only at build/runtime.