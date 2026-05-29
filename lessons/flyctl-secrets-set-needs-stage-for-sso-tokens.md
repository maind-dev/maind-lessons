---
id: lsn_flyctl_secrets_set_needs_stage_for_sso_tokens
title: "Fix `missing third-party discharge token` from `flyctl secrets set` — write with `--stage` on SSO orgs"
type: debugging_lesson
tier: community
summary: "`flyctl secrets set KEY=VAL -a <app>` without `--stage` writes the secret AND restarts machines atomically. The restart half needs a Fly macaroon discharge that browser-login tokens on SSO-protected orgs often lack. Symptom: `missing third-party discharge token` though `flyctl status`/`secrets list`/`deploy` work. Use `--stage` to write only; the next deploy activates the secret atomically."
context:
  tools: []
  languages: []
  platforms: ["fly"]
  tags: ["fly", "fly.io", "flyctl", "secrets", "deployment", "authentication", "macaroon", "sso"]
---

## Symptom and diagnostic flow

The error from `flyctl secrets set MY_KEY=val -a <app>` (no `--stage`):

```
Error: update secrets: failed to update app secrets: verify:
  invalid token: all tokens missing third-party discharge tokens;
  no verified tokens; token <uuid>: missing third-party discharge
  token (Request ID: …)
```

The same token works for several adjacent operations, so it doesn't
look like an auth problem:

| Operation | Works with the same token? |
|---|---|
| `flyctl status -a <app>` | yes (read-only) |
| `flyctl secrets list -a <app>` | yes (read-only) |
| `flyctl deploy …` | yes (restart goes through a separate endpoint) |
| `flyctl secrets set --stage` | yes (no restart) |
| `flyctl secrets set` (without `--stage`) | **no** |

That table is also the diagnostic flow. Walk it top-to-bottom:

```bash
# 1. Token alive for reads? Rules out generic auth death.
flyctl status -a <app>
flyctl secrets list -a <app>

# 2. Fly service outage producing 503/401 noise?
curl -sS https://status.flyio.net/api/v2/status.json \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["status"]["indicator"],"-",d["status"]["description"])'

# 3. Discharge gap confirmed? Try --stage.
flyctl secrets set MY_KEY=val -a <app> --stage
```

If step 3 succeeds, you have the macaroon-discharge gap specifically;
the token is otherwise healthy. Classic "log out, log in again" does
NOT help — the freshly-issued browser token may have the same gap,
because Fly's SSO discharge isn't always issued at interactive-login
time for combined-write-and-restart operations.

## Why this happens

Macaroons are bearer tokens with **caveats** — conditions baked into
the token that must be discharged by separate proofs at request time.
SSO enforcement adds a caveat: "this token is valid only if a
verified-SSO discharge is presented alongside it." Different Fly API
endpoints require different caveats. Read endpoints typically don't;
machine-mutating endpoints do.

`flyctl deploy` carries the discharge through a code path that has
been hardened around SSO-org workflows. `flyctl secrets set` without
`--stage` is the one command that mixes a config-write with an
immediate machine-restart, and its discharge handling historically
hasn't been brought up to the same level. The result is the
confusing partial-failure pattern: read works, normal deploys work,
this one combined operation doesn't.

## Workaround

For the secret-before-deploy flow (ship new code that reads the
secret, want both atomic on cutover):

```bash
# 1. Stage the secret now — uses only secrets:write
flyctl secrets set MY_KEY=$(generate-strong-value) -a <app> --stage

# 2. Later: deploy ships new code AND activates all staged secrets atomically
flyctl deploy --config apps/<svc>/fly.toml \
              --dockerfile apps/<svc>/Dockerfile \
              -a <app>
```

For a hot secret update (no code change, immediate restart required):

- **Web UI fallback** at `https://fly.io/apps/<app>/secrets` —
  acts against your browser SSO session, which carries the full
  discharge set. Sidesteps the local CLI macaroon entirely.
- **Wider-scoped token** from `https://fly.io/org/<slug>/tokens` —
  create a deploy-scope access token, then `export FLY_API_TOKEN=…`
  before re-trying.

This mirrors the discipline in [[lsn_supabase_secrets_set_project_ref_required]]:
on both Fly and Supabase, the implicit/bundled secret-set form saves
a few keystrokes but hides specific failure modes that the explicit
two-step form (set, then deploy) makes deterministic.

## Detection retrospectively

If a previous teammate's secret-set attempt failed and they didn't
follow up, the orphan symptom is **staged secrets that nobody
remembers staging**:

```bash
flyctl secrets list -a <app>
# Look for secrets with status "Staged" that you don't recognize.
# Each one is a previously-failed direct-set that the CLI silently
# half-completed before erroring.
```

When orphans exist, audit them before the next deploy — the deploy
will activate them all atomically, including values you may not have
intended. Either purge with `flyctl secrets unset <name> -a <app>
--stage`, or accept and re-set with the desired value.

If you have a maind MCP integration installed, surface related
patterns with:

```
search_lessons({ platforms: ["fly"], tags: ["secrets"] })
```

to find adjacent vetted conventions before applying this one.

## When this does not apply

- **Personal Fly accounts without SSO:** discharges are simpler;
  the direct (no-stage) variant usually works.
- **CI environments using `FLY_API_TOKEN`:** the deploy token issued
  from the Fly dashboard generally has full discharge coverage. The
  gap is specific to interactive browser-login tokens against SSO orgs.
- **Older flyctl versions (< 0.1.x):** before the macaroon migration,
  Fly used a single static auth token. The two-tier discharge model
  didn't exist; the symptom can't occur.
- **Transient Fly outages:** 503/401 noise during a `status.flyio.net`
  incident can look identical from the CLI. Step 2 of the diagnostic
  flow distinguishes — if Fly reports an active incident, wait it out
  before assuming a discharge problem.