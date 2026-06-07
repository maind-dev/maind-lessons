---
id: lsn_next_middleware_shadows_m2m_routes
title: Fix a webhook/cron API route redirecting to /login (307) — Next.js auth-middleware shadows M2M endpoints
type: debugging_lesson
tier: community
summary: An auth middleware (Supabase-SSR `updateSession`) with a broad matcher runs on `/api/*` too. A cookieless machine-to-machine route (webhook/cron with a Bearer/HMAC header) hits the `!user → redirect to /login` gate, so the caller gets a 307 to `/login` (HTML) and the handler never runs. Takeaways — a 307→/login is NOT a 404 (middleware shadows the route before routing), and every M2M endpoint must be in the middleware's public-paths allowlist.
context:
  languages: [typescript]
  platforms: [nextjs, supabase]
  tags: [nextjs, middleware, app-router, webhook, cron, machine-to-machine, auth]
---

## The trap

A cron or webhook — a pg_cron→Edge→`/api/...` chain, a Stripe/GitHub webhook, a scheduler hitting your endpoint — POSTs to your Next.js App Router API route with a shared-secret `Authorization: Bearer ...` (or HMAC signature) header and **no user session**. The caller expects your route's JSON but gets HTML, or a JSON client like `jq` chokes with a parse error. `curl -i` shows:

```
HTTP/2 307
location: /login?next=%2Fapi%2Fcron%2Fdispatch
content-type: text/html
```

Your route handler never executed.

## Why

The Supabase-SSR auth middleware uses a broad matcher that excludes only static assets:

```ts
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
```

That matches `/api/*` too. Inside `updateSession`, the gate is:

```ts
if (!user && !isPublic) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", path);
  return NextResponse.redirect(url); // 307
}
```

A cookieless M2M request has no `user` → it is redirected to `/login` **before** Next routes to your handler. The middleware *shadows* the route.

## Two consequences

**1. A 307→/login is not a 404.** Because the redirect happens at the middleware layer, before routing, you cannot infer from a 307 whether the route is deployed, mis-pathed, or merely not allowlisted. Do not read "307→/login" as "route missing" — it only tells you the middleware ran and the path was not public.

**2. M2M endpoints must be explicitly allowlisted.** Mirror how existing webhooks are handled — add the path so the `!user` gate is skipped:

```ts
const PUBLIC_PATHS = [
  "/login", "/auth/callback",
  "/api/webhooks/stripe",   // HMAC / signature header
  "/api/cron/cleanup",      // Bearer shared-secret (scheduler → endpoint)
  "/api/cron/dispatch",     // ← your new M2M route
];
const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));
```

The route still runs its own Bearer/HMAC check — the allowlist only tells the *cookie-auth* middleware to step aside. (Add the route to the allowlist, not loosen the matcher: you still want session-refresh on real pages.)

## Detection

- `curl -i <route>` → `HTTP 307` + `location: /login?next=...` + `content-type: text/html` = middleware redirect, not your handler.
- A JSON client reporting a parse error ("Invalid numeric literal", "Unexpected token <") on a route you control = you are receiving the HTML login page instead of your JSON.
- Your route handler always returns JSON (even on 401/500). If the body is HTML, the request never reached the handler — look one layer up, at the middleware.

## When this applies / doesn't

- **Applies** to any Next.js App Router app with an auth middleware whose matcher covers `/api` and which redirects unauthenticated requests (the Supabase-SSR `updateSession` pattern is the common case).
- **Does not apply** if your matcher already excludes `/api`, or the M2M route lives under a path the matcher skips — though excluding all of `/api` from session-refresh has its own trade-offs.
- **Adjacent but different** — a Supabase Edge-Function gateway 401 is the Supabase layer, not Next middleware ([[lsn_supabase_edge_function_auth_header]]); and `notFound()`/redirect masking real errors *inside* a route is [[lsn_app_router_notfound_masks_errors]].

## Find this from a symptom

```js
search_lessons({ query: "next.js webhook cron route 307 redirect login middleware public paths bearer", platforms: ["nextjs"] })
```
