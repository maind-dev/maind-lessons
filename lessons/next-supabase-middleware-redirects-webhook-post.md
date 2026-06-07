---
id: lsn_next_supabase_middleware_redirects_webhook_post
title: "Fix a webhook/cron POST that 307-redirects to /login — Supabase SSR middleware must allowlist the route"
type: debugging_lesson
tier: community
summary: "A Next.js App Router webhook/cron route (cookie-less POST, shared-secret Bearer) silently 'does nothing'; the caller gets a JSON-parse error ('Unexpected token <'). Cause: Supabase SSR auth middleware finds no user session and 307-redirects to /login, so the caller receives login HTML, not your JSON — the handler never runs. Fix: allowlist the route path in the middleware (PUBLIC_PATHS) and authenticate inside the handler with the shared secret instead."
context:
  languages: [typescript]
  platforms: [nextjs, supabase]
  tags: [nextjs, supabase-ssr, middleware, webhook, cron, auth]
---

## Symptom

You add an `/api/...` route handler to be called by a webhook (Stripe,
GitHub, an email provider) or a cron/edge-function dispatcher. It is
authenticated by a shared-secret `Authorization: Bearer` header, NOT a user
session cookie. In testing the caller gets one of:

- `SyntaxError: Unexpected token '<' ... is not valid JSON`
- `jq: Invalid numeric literal`
- a `307` followed by a `200` that returns the **login page HTML**

…and your handler's logs show it never executed.

## Why

With the Supabase SSR pattern the **Edge middleware** runs
`supabase.auth.getUser()` on every matched request and redirects
unauthenticated traffic to `/login`. A webhook/cron POST carries no auth
cookie (it uses a Bearer secret, which the middleware doesn't know about),
so the middleware sees "no user" → **307 → /login**. The caller follows the
redirect and gets HTML; your route handler is never reached. The JSON-parse
error is the downstream tell — the caller tried to `JSON.parse` an HTML login
page.

## Fix: allowlist the route, authenticate in the handler

Add the route's path to the middleware's public-path allowlist (the set it
skips before the auth redirect) — the same list that already exempts
`/login`, OAuth callbacks, and existing webhooks (Stripe, etc.):

```ts
// middleware helper (e.g. lib/supabase/middleware.ts)
const PUBLIC_PATHS = [
  "/login", "/auth/callback",
  "/api/stripe/webhook",
  "/api/agent/dispatch",      // ← add your webhook/cron route
];

if (PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))) {
  return NextResponse.next();   // skip the getUser()-redirect
}
```

Allowlisting middleware does **not** make the route unauthenticated — you
move auth from the cookie-session check to the handler itself:

```ts
// app/api/agent/dispatch/route.ts
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.DISPATCH_SECRET}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // ... do the work with a service-role client ...
}
```

## Verify

```bash
curl -i -X POST https://app.example.com/api/agent/dispatch
# BEFORE: HTTP/1.1 307 Temporary Redirect, location: /login
# AFTER:  HTTP/1.1 401 {"error":"unauthorized"}  (handler ran, secret missing)
```

A `401`/`200` JSON from your handler — not a `307` to `/login` — is the
done-proof.

## When this does NOT apply

- **User-facing routes** that SHOULD require a session — keep them gated;
  don't allowlist them.
- **Routes that read the user session** — a webhook/cron has none; design it
  to resolve identity server-side (service-role + a workflow/owner lookup),
  not via `auth.uid()`.

## Related

See [[lsn_supabase_getuser_react_cache_dedupe]] for the middleware↔RSC
`getUser()` boundary, and [[lsn_supabase_edge_function_auth_header]] for the
mirror-image gateway-auth rule on Supabase Edge Functions.

```
search_lessons({ query: "next.js supabase middleware webhook route redirect login 307", platforms: ["nextjs","supabase"] })
```
