---
id: lsn_next_revalidate_path_scope_render_storm
title: "Diagnose a Server Action that never confirms — revalidatePath('/', 'layout') re-renders the entire app"
type: debugging_lesson
tier: community
summary: >-
  A Server Action whose mutation demonstrably succeeded, whose button stays pending for tens of
  seconds, and whose logs contain no error at all is usually neither the database nor a
  third-party call. `revalidatePath("/", "layout")` invalidates every route under the root
  layout, so the whole navigation surface re-renders and the action's response queues behind
  that storm. Count renders-per-click in the access log first, then revalidate only the pages
  that visibly changed.
context:
  tools: [nextjs, vercel]
  languages: [typescript, sql]
  platforms: [nextjs, vercel, supabase]
  tags: [nextjs, app-router, server-actions, revalidatepath, performance, debugging, latency]
---

## The symptom triad

A `<form action={serverAction}>` submit where all three hold at once:

1. **The mutation worked.** The row is in the database; a page reload shows it.
2. **The confirmation never arrives.** `useFormStatus().pending` stays true — the button sits on "Saving…" / "Inviting…" for tens of seconds, often until the user gives up and reloads.
3. **Nothing is logged.** No 4xx, no 5xx, no exception, no timeout — neither in the app logs nor in the database.

That combination is the fingerprint. A failing action logs. A slow query shows up as a slow query. Here every layer reports success and the user still stares at a dead button — which is exactly why this gets misdiagnosed twice before anyone measures.

## The two wrong turns (both are the obvious ones)

**"It must be the external call in the action."** Mail send, webhook, analytics — something in the action awaits a network call with no timeout. Plausible, and worth fixing on its own (move it behind `after()` from `next/server`, add a `Promise.race` timeout), but if the symptom survives that change, it was never the cause. Ship the hygiene fix, then keep looking.

**"It must be the database."** Exonerate it with a measurement instead of a guess. You can call a *mutating* RPC as the actual end user and throw the result away:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<user-uuid>","role":"authenticated"}';
SELECT public.your_mutating_rpc('…');
ROLLBACK;
```

Two practical notes. Many SQL CLIs return only the last statement's result, so interleaved `clock_timestamp()` calls are invisible — wall-clock the whole invocation against a `SELECT 1` baseline instead and subtract the transport overhead. And run it as the user who reported the problem: an RPC gated on `auth.uid()` behaves differently for an admin.

In the incident behind this entry, the RPC answered in 68 ms. The database was out.

## The measurement that actually decides it

Count **server renders per click**. One user action should produce roughly one render.

```bash
# Vercel; any host's access log works the same way
vercel logs <deployment-url> --limit 500 --json > /tmp/logs.jsonl
```

```python
import json, collections
rows = [json.loads(l) for l in open('/tmp/logs.jsonl') if l.startswith('{')]
gets = [r for r in rows if r.get('requestMethod') == 'GET']
print(len(gets), 'renders across', len({r['requestPath'] for r in gets}), 'routes')
print(collections.Counter(r.get('cache') for r in gets))
```

Measured after a single "Send invite" click: **480 GET renders across 32 distinct routes within 7 seconds, every one `cache: MISS`, and not one non-2xx**. The 32 routes were the sidebar's 22 nav links plus their subpages — the app's entire navigation surface, re-rendered fifteen times over. If your number is single-digit, stop here and look elsewhere.

The same count is also the acceptance test **after** the fix: a correct change takes it from hundreds to single digits. Latency fixes get confirmed by relief far too often — "it feels faster now" is not a verification, least of all for a failure mode whose defining property was that nothing ever looked wrong.

## The cause, the fix, and the comment that spread it

```ts
revalidatePath("/", "layout");   // "just invalidate the sidebar counter"
```

Every page in an App Router app sits under the root layout, so this invalidates **all of them**. The client router cache for the whole tree goes stale, every `<Link>` in the viewport re-prefetches, and each prefetch is a real server render that re-runs the layout's data fetches. The action's own response is produced by the same function pool it just saturated — the response the button waits for is queued behind the storm the button caused. Nothing fails, which is why nothing is logged.

The fix is to name the pages that visibly change:

```ts
revalidatePath("/organization");          // the pending list + the seat counter live here
revalidatePath("/settings");              // …and here, if the value is really shown there
```

One check question before every `revalidatePath` call: **which page displays this data?** If the honest answer is "a badge in the sidebar", note that per-user layout data cannot be refreshed for a *different* user from your request anyway — that call buys nothing and costs a full re-render.

### Fix the comment in the same commit

In the incident, the file header recommended the sledgehammer in writing:

```ts
// Convention: revalidatePath("/", "layout") on every successful mutation
// — invalidates the Sidebar inbox-count + the organization page + the
// settings page in one shot.
```

It had spread to **71 call sites in 18 files** — including one written the same morning by someone who had just read that header. A house rule that is wrong is worse than none: it turns a mistake into a style, and review waves it through because it matches the file it lives in. Fix the calls and the comment together, or the next copy-paste restores the bug.

### Sibling finding: an idempotent RPC needs its own UI state

The same form hid a second defect. The invite RPC is deliberately idempotent — on an already-open invitation it returns `{noop: true}` instead of raising. The action mapped that to `status: "saved"`, so the UI claimed an invitation had been sent that never was.

`noop` is neither success nor failure. Give it a third state:

```ts
export type ActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "info";  message: string }   // nothing was wrong, nothing happened
  | { status: "saved"; message?: string };
```

Render it neutrally ("already invited, valid until 24/08") — not as a red alert, because nothing went wrong, and never as success. Users read a missing state change as a broken button, which is how this one stayed hidden behind the latency bug.

## When this does NOT apply

- **The action already revalidates one or two specific paths and still hangs.** Then this is not your cause — measure the render count of the *current* page instead, and look at what that page's Server Component awaits.
- **Few or no `<Link>` elements on screen** (a single-page tool, a modal-only surface). Without a navigation surface to re-prefetch there is no storm, and a broad revalidation is merely wasteful rather than blocking.
- **Fully static or fully client-rendered pages.** Re-rendering them is cheap; the storm needs per-request server work — layout data fetches, auth round-trips — to hurt.
- **The confirmation never arrives *and* the mutation did not happen.** That is an ordinary failure with an ordinary cause; go read the error you are about to find.

## Related

Retrieve this from a symptom:

```js
search_lessons({ query: "server action never confirms button stays pending revalidatePath layout", platforms: ["nextjs"] })
get_lesson({ id: "lsn_next_revalidate_path_scope_render_storm" })
```

- [[lsn_next_server_action_redirect_blocks_navigation]] — the same structural trap one step earlier: work awaited *inside* the action before `redirect()` blocks the transition. Both say the response waits for everything you put in front of it.
- [[lsn_next_server_action_form_must_not_throw]] — what happens when the action fails instead of stalling.
- [[lsn_vercel_isr_writes_budget]] — the billing-side sibling: over-broad revalidation as a cost problem rather than a latency one.
- [[lsn_postgres_view_security_invoker_default]] — carries the same `SET LOCAL request.jwt.claims` impersonation snippet, there as an RLS read-check rather than a latency probe.
- [[lsn_supabase_getuser_react_cache_dedupe]] — why each of those re-renders costs more than it looks: `getUser()` is a network round-trip, and the layout runs it on every one of them.
