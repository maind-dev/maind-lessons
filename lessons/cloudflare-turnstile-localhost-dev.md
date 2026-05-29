---
id: lsn_cloudflare_turnstile_localhost_dev
title: Fix Cloudflare Turnstile "Error 110200" on localhost — use the documented test-keys for dev, real keys for prod
type: debugging_lesson
tier: community
lesson_class: general
quality_tier: hand-vetted
context:
  tools:
    - cloudflare-turnstile
  languages: []
  platforms: []
  tags:
    - cloudflare
    - turnstile
    - captcha
    - localhost-dev
summary: >-
  Cloudflare Turnstile throws "Error 110200 — Domain not allowed" on
  `http://localhost:<port>` even when `localhost` is explicitly listed
  under Hostname Management. The official docs claim "localhost is
  always allowed" — in practice this depends on the account/widget
  combo and fails often. Use the documented test-keys (always pass,
  no hostname check) for dev. Pattern is like Stripe's `sk_test_` /
  `sk_live_` — swap to real keys before prod deploy.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The symptom

You add Cloudflare Turnstile to a form, deploy locally
(`http://localhost:3000` or similar), and the widget fails with:

```
Error 110200 — Domain not allowed
```

You go to the Cloudflare dashboard, add `localhost` to "Hostname
Management" for the widget — error persists. You rotate the
site/secret keys, hard-reload, clear cookies — still 110200.

You push the same code to production with the production hostname
(`yoursite.com`) listed in the widget — works first try, even with
auto-pass.

The bug is environment-specific to your local setup, not a code bug.

## What's actually happening

Cloudflare's documentation says "localhost is always allowed in
Turnstile." In practice, this depends on the specific account/widget
configuration, and "always" turns out to mean "usually, but not
reliably." Reports differ across accounts; some users see it work
without effort, others can't make it work even with explicit hostname
allow-listing.

Treat localhost-Turnstile as **unreliable by default**.

## The fix — Cloudflare's documented test-keys

Cloudflare publishes site/secret key pairs explicitly for dev/test
use. They always pass validation and ignore the hostname entirely:

| Purpose | Site key | Secret key |
|---------|----------|-----------|
| Always-pass (dev) | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Always-fail (test failure paths) | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |
| Always-pass with bot-flag (test bot detection) | `3x00000000000000000000FF` | `1x0000000000000000000000000000000AA` |

Use the always-pass keys for local dev:

```env
# .env.local
EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

The widget renders, returns a valid token, and the server-side verify
endpoint accepts it. No hostname configuration needed.

## The pattern — `sk_test_` / `sk_live_` discipline

This is the same pattern as Stripe's `sk_test_` vs `sk_live_` keys:

- **`.env.local` / dev container:** test-keys
- **Staging:** real keys (real account, not test-keys — staging should
  exercise the actual Turnstile validation path)
- **Production:** real keys

**Before any prod deploy, swap BOTH sides:**

- Frontend env (`.env.production`, Coolify build-arg, Vercel env, etc.)
- Backend secret (Supabase Edge Function secret, server env var)

If only the frontend gets prod keys but the backend still has test-keys,
the verify endpoint accepts *any* token the client sends — including
forged or replayed ones — because test-keys always pass. That's a real
security hole, not a theoretical one.

If you mix a site key from widget A with a secret key from widget B, verify always returns "invalid token" — even when the client produces a real token. When rotating one key, rotate both, and set them in both places (frontend env + backend secret) in one operation. Stale mismatches cost hours of debugging.

## When this does not apply

- **Tunnelled localhost dev** (`ngrok`, Cloudflare Tunnels, etc.) where
  your local server is reached through a real hostname. In that case,
  add the tunnel hostname to the widget's hostname list and use real
  keys — the localhost problem doesn't exist.
- **CI / E2E tests against a real Turnstile widget.** Use the
  always-fail test-keys to exercise the failure paths. Don't try to
  make real keys work in CI; the hostname won't match.
- **Server-rendered apps that don't touch Turnstile until a form is
  actually submitted.** If your local dev never reaches the form, you
  don't need any keys until you do — defer the swap.

## Verification

```bash
# Dev env
grep TURNSTILE .env.local
# EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA   ← test-key

# Prod env (Coolify / Vercel / etc.)
echo "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" | grep -E '^0x4AAAAAAA'
# 0x4AAAAAAA…                                              ← real-key prefix

# Server-side secret (also must be real)
echo "$TURNSTILE_SECRET_KEY" | grep -E '^0x4AAAAAAC'
# 0x4AAAAAAC…                                              ← real-key prefix
```

The prefix heuristic (`0x4AAAAAAA…` for site, `0x4AAAAAAC…` for
secret) is a useful smoke-test but NOT authoritative — Cloudflare can
issue keys with other prefixes. The authoritative check is in the
widget's Dashboard label.
