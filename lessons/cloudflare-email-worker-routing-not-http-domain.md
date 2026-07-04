---
id: lsn_cloudflare_email_worker_routing_not_http_domain
title: "Diagnose a Cloudflare Email Worker that gets no mail: trigger via Email Routing, not the Worker Domains tab"
type: debugging_lesson
tier: community
lesson_class: architecture
quality_tier: hand-vetted
context:
  tools:
    - wrangler
  languages: []
  platforms:
    - cloudflare
  tags:
    - cloudflare
    - email-routing
    - email-workers
    - inbound-email
    - dns
summary: >-
  A Cloudflare Email Worker (an `email()`-handler Worker) is invoked only by an
  Email Routing rule with action "Send to a Worker" — never by attaching it to a
  hostname in its "Domains" tab. That tab creates an HTTP custom domain
  (`fetch`); for an email-only Worker it routes no mail and every HTTP hit
  errors. On Free, catch-all exists only on the apex zone and subdomains take
  only specific addresses, so dynamic local-parts need one rule per address.
last_validated_at: "2026-06-08"
upvotes: 0
---

## The trap

You deploy a Cloudflare Email Worker (a Worker exporting `email(message, env)`)
and want mail to reach it. The Worker dashboard's **Domains & Routes** tab
invites you to "add a custom domain", and Cloudflare's own help text says
"attach your Worker to any subdomain". You add `inbound.yourdomain` there, send
a test mail … and nothing arrives. The Worker dashboard instead shows requests
piling up as **errors** (e.g. "7 requests / 7 errors").

## Why it can't work

The "Domains" tab binds an **HTTP** hostname to the Worker's `fetch()` handler
(`https://inbound.yourdomain` → Worker). Inbound **email** has nothing to do
with HTTP: it arrives via **MX records** and is dispatched by **Email Routing**,
which invokes the Worker's `email()` handler. An email-only Worker has no
`fetch()` handler, so every HTTP request to that custom domain errors — that is
exactly the "N requests / N errors". The HTTP binding is not just useless for
email; it manufactures error noise.

## The correct wiring

1. **Email Routing owns the trigger**, not the Workers Domains tab:
   Email → Email Routing → create a **rule** whose **action = "Send to a
   Worker"** → pick your Worker. That (plus the zone MX, which Email Routing
   provisions) is what delivers mail to `email()`.
2. **Receiving at a subdomain** (`inbound.yourdomain`): add it under
   **Email Routing → Settings → Add subdomain** — NOT the account-level "Add a
   domain/site" wizard (accepts root domains only → "provide the root domain"),
   and NOT as a separate zone (subdomain zones need NS delegation = Enterprise).
3. **Dynamic local-parts** (e.g. `wf-<token>@…`): on Free, **catch-all exists
   only on the apex zone**; subdomains allow only **specific addresses**. So
   create one routing rule per address (e.g. via the Email Routing API), or use
   the apex catch-all. A specific-address rule coexists with an existing apex
   catch-all — only exact matches hit the Worker; all other mail keeps flowing
   to your existing routes.

## Adjacent token gotcha

To create routing rules via the API, use a **user-owned** token (`cfur_`),
permission **Zone › Email Routing Rules › Edit**, scoped to the zone. An
**account-owned** token (`cfat_`) was observed to fail with `10000
Authentication error` despite an identical, correct scope (the account-token
policy editor did not attach the permission cleanly). `10000` means the
credential is invalid — distinct from `9109` (insufficient permission) and
`7003` (wrong zone identifier: a domain name or Account-ID used where the 32-hex
Zone-ID belongs). The Worker also will not deploy until the Cloudflare account
email is verified (`code: 10034`). Same family as
[[lsn_github_fine_grained_pat_per_owner]] — a scoped-token gotcha where the raw
error code masks the real cause.

## When this does not apply

- A Worker that genuinely serves HTTP (has a `fetch()` handler) — then the
  Domains tab is exactly right.
- Inbound providers other than Cloudflare (a dedicated inbound-email API, etc.)
  have their own delivery model; this is specific to Cloudflare Email Routing +
  Email Workers.

## Find this again

```
search_lessons({ query: "cloudflare email worker email routing http custom domain", platforms: ["cloudflare"] })
```
