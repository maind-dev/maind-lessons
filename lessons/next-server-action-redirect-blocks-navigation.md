---
id: lsn_next_server_action_redirect_blocks_navigation
title: "Diagnose dead-feeling Server-Action navigation — DB work before redirect() blocks the transition"
class: lesson
type: debugging_lesson
tier: community
context:
  tools: []
  languages:
    - typescript
  platforms:
    - nextjs
  tags:
    - nextjs
    - app-router
    - server-actions
    - navigation
    - optimistic-ui
    - performance
last_validated_at: "2026-06-03"
summary: |
  A `<form action={serverAction}>` whose action does DB work (reads + writes) and then `redirect()`s blocks the whole navigation until all of it finishes — and Server Actions are not prefetchable. In multi-step flows the click feels dead. Decouple the write (fire-and-forget action, no redirect) and navigate client-side via router.push inside useTransition, with the pending flag driving a spinner.
---

In the Next.js App Router, a "Continue" control implemented as
`<form action={advanceStep}>` where `advanceStep` is a Server Action that
(1) reads context from the DB, (2) writes progress, (3) calls
`revalidatePath`, and (4) `redirect()`s, makes the user wait for **all four**
before anything visible happens. The POST round-trip is also not
prefetchable the way a `<Link>` is, so there is no way to warm it. On a
multi-step wizard this reads as "the button is dead for a beat, then the page
swaps."

The latency is structural, not cosmetic — it is easy to misattribute it to an
unrelated change (a CSS tweak, a new component) when the real cost was always
the blocking action. Two confounders make this worse during diagnosis:

- `next dev` compiles each route on first visit, so the first navigation to
  any step is always slow — not representative of production.
- If the target pages are `export const dynamic = "force-dynamic"`, they are
  never prefetched or cached, so even a client navigation re-renders them on
  the server.

## The fix: decouple the write, navigate optimistically

Split the one blocking action into (a) a write-only Server Action with **no**
redirect, called fire-and-forget, and (b) a client-side `router.push` inside
`useTransition` so the navigation starts immediately and the `isPending` flag
can drive a spinner (so the click is never "dead").

```ts
// actions.ts — write only, no redirect, fail-soft
"use server";
export async function recordStepProgress(step: string): Promise<void> {
  const ctx = await loadSequenceContext();
  const next = nextStepOf(step, ctx);            // derive server-side, don't trust client
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_step", { p_step: step, p_next: next });
  if (error) { console.error("[onboarding] progress write failed:", error.message); return; }
  revalidatePath("/onboarding", "layout");
}
```

```tsx
// StepNavActions.tsx — "use client"
const router = useRouter();
const [isPending, startTransition] = useTransition();

function handleContinue() {
  void recordStepProgress(step);                 // background; does NOT block nav
  startTransition(() => router.push(targetUrl)); // immediate; isPending → spinner
}
// <button disabled={isPending} aria-busy={isPending}> guards against double-clicks
```

The server stays the source of truth for the *next* target and for the label
(compute them in the parent Server Component and pass them down); the client
only owns the transition.

## Trade-offs you are accepting

- **No progressive enhancement.** The control is now a JS `onClick`, not a
  form submit — fine for an authenticated dashboard, not for a public no-JS
  page.
- **Optimistic = the write may lose.** If the fire-and-forget write fails, the
  user still advanced; persisted progress is briefly inconsistent and
  reconciles on the next step or reload. Only acceptable for non-critical
  writes (wizard progress), never for payments or anything that must be
  durable before the user moves on.
- **Not actually "instant" under force-dynamic.** The target page still
  server-renders. The win is (a) the write is off the critical path and
  (b) immediate visual feedback. For true instant transitions, drop
  `force-dynamic` on the content-only steps so they can be prefetched.

## When NOT to do this

If the write must be durably committed before the user is allowed to proceed
(checkout, irreversible state change, a final "finish" step that triggers
downstream effects), keep the blocking action — but still add a `useFormStatus`
pending state so the click isn't dead. Optimistic decoupling is for steps where
advancing-then-reconciling is safe.

## Differentiating from related Server-Action navigation issues

| Symptom | Cause |
|---|---|
| Click feels dead, then the page swaps after a beat | Blocking Server Action does DB work before redirect (this convention) |
| First visit to a step is slow, repeat visits fast | `next dev` on-demand compilation — not a prod signal |
| Client navigation still re-renders on the server every time | Target page is `force-dynamic` — not prefetchable |
| A modal/animation disappears the instant a Server Action completes | Post-action auto-revalidation re-runs a Server-Component redirect guard — a separate, correctness bug, not latency |

The tell for *this* failure mode is that nothing is visibly wrong except the
wait, and the wait scales with how much DB work the action does before it
redirects.
