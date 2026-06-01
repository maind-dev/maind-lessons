---
id: lsn_fly_deploy_unauthorized_lease_check_status_first
title: "Diagnose `fly deploy` `unauthorized` on lease/smoke-check that already rolled out (Machines-API token discharge)"
type: debugging_lesson
tier: community
summary: "A `fly deploy` that ends non-zero with `unauthorized` on lease-refresh/clear and smoke-check — after a successful build+push — usually did NOT fail: run `fly status` first, the image often already rolled out with passing checks. Cause: `fly auth docker` refreshes only the registry credential, not the Machines-API macaroon; on SSO orgs the browser token lacks the discharge for machine lease/get calls. Fix: re-auth via `fly auth login` or a scoped deploy token, then re-deploy the same image."
context:
  platforms:
    - fly
  tags:
    - fly
    - fly.io
    - flyctl
    - deployment
    - authentication
    - macaroon
    - sso
    - diagnostic-signals
---

## Symptom

`fly deploy --app <app> --image <tag>` (or a full build+deploy) ends with a
non-zero exit and a wall of `unauthorized`, even though the preceding
`docker build` and `docker push` both succeeded:

```
ext-<sha>: digest: sha256:… size: 4430          ← push OK
…
Updating existing machines in '<app>' with rolling strategy
[1/2] Machine <id-a> reached started state
WARN error refreshing lease for machine <id-b>: … unauthorized
 ✖ [1/2] Failed to clear lease for <id-a>: unauthorized
 ✖ [2/2] Failed to clear lease for <id-b>: unauthorized
Error: failed to update machine <id-b>: Unrecoverable error:
  smoke checks … failed: failed to get VM <id-b>: unauthorized
```

It reads like a total failure. It usually is not.

## First move: `fly status` — the deploy may have succeeded

Before assuming the rollout failed, read the actual machine state:

```bash
fly status -a <app>
```

In the originating incident both machines already showed the **new image and
version with `1 passing` health-check** — the image rollout completed. What
aborted was only the deploy orchestrator's **lease-management and smoke-check
phase**, which talks to the Fly Machines API and got `unauthorized`. The
signature is diagnostic: machine **create/start** succeeded
(`reached started state`), but **lease-refresh / lease-clear / get-VM**
uniformly returned `unauthorized` — operations that need a fresh discharge
fail; the ones already in flight don't.

### Red herring: "not listening on 0.0.0.0:<port>"

The rolling deploy often prints, transiently,
`WARNING The app is not listening on the expected address … 0.0.0.0:<port>`.
This is usually a **boot-timing artifact**, not the failure — Fly probes the
socket before the app finished starting (model load, warm-up, migrations). If
your server does `listen(PORT)` without a host, Node binds all interfaces
(`0.0.0.0`) anyway. Green health-checks and a direct `curl …/<health-path>`
are the ground truth; don't chase the listening warning when the real error is
the `unauthorized` lease block.

## Root cause: `fly auth docker` ≠ Machines-API auth

Fly uses two independent auth paths, and the common deploy script only
refreshes one of them:

| Operation | Token source | Refreshed by `fly auth docker`? |
|---|---|---|
| `docker push registry.fly.io/…` | Registry credential (Docker config) | ✅ yes |
| `fly deploy` → machine create / start / **lease** / **get** | Fly macaroon (`~/.fly/config.yml` / `FLY_API_TOKEN`) | ❌ no |

`fly auth docker` writes only a short-lived registry login into the Docker
config. The Machines-API macaroon is untouched. On an **SSO-protected org**,
the interactive browser-login token carries caveats whose **third-party
discharge** for machine-mutating/-reading calls (lease refresh/clear, get VM)
is missing or expired → `unauthorized`. Corroborating signal: `fly auth whoami`
may emit `Warning: Metrics token unavailable: … context canceled` — the same
gap on an adjacent endpoint. This is the same macaroon-discharge family as
[[lsn_flyctl_secrets_set_needs_stage_for_sso_tokens]] (there: `secrets set`
without `--stage`), surfacing on a different command.

## Fix and verify

Re-authenticate with full discharge, then re-run the deploy. No rebuild is
needed — the image is already in the registry.

```bash
# A) Browser re-login — picks up the SSO discharge
fly auth login

# B) OR a scoped deploy token — deterministic, CI-friendly, full discharge
fly tokens create deploy -a <app> -x 1h
export FLY_API_TOKEN=<token>

# Re-deploy the already-pushed image, then verify
fly deploy --app <app> --image registry.fly.io/<app>:<tag> --config <path>/fly.toml
fly status -a <app>                         # all machines new version, checks passing
curl -fsS https://<app-or-custom-domain>/<health-path>
```

A clean run shows `✔ Cleared lease for <id>` for every machine and exits 0.

## When this does not apply

- **Personal Fly accounts without SSO:** discharges are simpler; this specific
  `unauthorized`-on-lease pattern is unlikely.
- **Genuine image failure:** if `fly status` shows the machines did NOT advance
  to the new version, or checks are failing/`critical`, you have a real rollout
  problem (bad CMD, crash on boot, wrong `internal_port`) — not this auth gap.
- **Registry push failure:** if `docker push` itself errored (`app repository
  not found`, layers stuck `Waiting`), that is the registry credential, fixed by
  `fly auth docker` — a different token path from this one.
- **Fly outage:** transient 401/503 noise during a `status.flyio.net` incident
  can look identical; check the status page before assuming a discharge gap.

## Related and generalisability

The discipline — *read the real resource state before trusting the command's
exit code* — is platform-agnostic; on Fly the second source is `fly status`.
It applies to any Fly.io app deployed from a CLI where build/push and the
machine update use separate credentials, especially on **SSO-protected orgs**
where browser-login macaroons lack discharges for machine-management calls.

- [[lsn_flyctl_secrets_set_needs_stage_for_sso_tokens]] — sibling macaroon-discharge gap on `flyctl secrets set`.
- [[lsn_verify_cli_side_effects_second_source]] — the meta-pattern: a CLI summary line can disagree with the real side-effect; verify via a second source.
- [[lsn_fly_monorepo_deploy_from_root]] — adjacent Fly deploy convention (build-context / COPY paths).

```
search_lessons({ query: "fly deploy unauthorized lease smoke check", platforms: ["fly"] })
```
