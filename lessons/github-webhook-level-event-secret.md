---
id: lsn_github_webhook_level_event_secret
title: 'Diagnose a GitHub webhook that delivers nothing: check level (repo/org/app), event (push vs pull_request), secret'
type: debugging_lesson
tier: community
context:
  tools:
    - gh
  languages: []
  platforms:
    - github
  tags:
    - github
    - webhook
    - hmac
    - ci
    - debugging
summary: "A receiver that never updates state usually has a webhook broken on one of three axes. (1) Level: a webhook can be at repo, org, OR GitHub-App level, and `gh api repos/<o>/<r>/hooks` shows ONLY repo-level, so org/app hooks are invisible there. (2) Event: it must be subscribed to the event the handler processes (e.g. pull_request), not push. (3) Secret: the endpoint HMAC secret must equal the server's. The only real proof is a target-event delivery returning HTTP 200."
last_validated_at: "2026-05-30"
---
A receiver that returns 200 to a health-check but never advances your state is almost always failing on one of three independent axes. All three must be right.

## Axis 1 — Level (repo / org / App)

GitHub delivers webhooks from three places:
- **Repo** webhook: `github.com/<owner>/<repo>/settings/hooks`
- **Org** webhook: `github.com/organizations/<org>/settings/hooks`
- **GitHub-App** webhook: in the App's own settings (fires for repos where the App is installed)

Trap: `gh api repos/<owner>/<repo>/hooks` lists ONLY repo-level webhooks. An org- or App-level webhook is invisible there, so "no hooks" via that API does NOT mean "no webhook". (Org hooks need the `admin:org_hook` scope to read; App hooks need the App's JWT.)

## Axis 2 — Event

The webhook must be subscribed to the event your handler processes. A handler that acts on `pull_request.closed` learns nothing from `push` events. A repo webhook left on the default "Just the push event" delivers a flood of pushes the handler ignores, and never the pull_request events you need. Subscribe to the right event explicitly.

## Axis 3 — Secret parity

GitHub signs each delivery with HMAC-SHA256 over the raw body using the webhook's secret. The receiver must verify with the SAME secret. Mismatch → HTTP 401 and the handler never runs. A "secret is configured on the server" check proves only the server half — it does NOT prove the two secrets match.

## Verification

The only real done-proof is a delivery for the TARGET event returning 200 — not "secret_configured", not "a webhook exists":

```bash
# Org-level deliveries (needs admin:org_hook) — look for 200 on the target event, not push:
gh api "/orgs/<org>/hooks/<hook-id>/deliveries?per_page=5" \
  --jq '.[] | "\(.event)/\(.action) -> \(.status_code)"'

# Only repo-level hooks are visible here (org/App are not):
gh api repos/<owner>/<repo>/hooks --jq '.[].config.url'
```

Then Redeliver a target-event delivery in the UI and confirm 200.

## Consolidate to one

Two webhooks pointing at the same endpoint with different secrets cause double-deliveries (one 200, one 401). Keep exactly one — App-level is scoped to the App's repos; org-level fires for every repo in the org (the handler ignores non-matching ones, but it is noisier).

## When this does not apply

- A 500 (not 401) from the endpoint means the server has no secret configured at all — different from a secret mismatch.
- Content type matters too: a handler that does `JSON.parse(rawBody)` needs `application/json`, not `application/x-www-form-urlencoded`.
