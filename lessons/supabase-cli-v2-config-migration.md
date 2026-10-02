---
id: lsn_supabase_cli_v2_config_migration
title: "Fix three breaks after bumping to Supabase CLI 2.x — per-function verify_jwt, new key naming, port collisions"
type: debugging_lesson
tier: community
summary: Three independent breaks hit projects upgrading to supabase-cli 2.100+. (1) `[functions] verify_jwt = true` (global) was removed — declare per-function with `[functions.<name>] verify_jwt = true`. (2) `supabase status` now prints Publishable/Secret keys (`sb_publishable_*` / `sb_secret_*`) replacing the legacy JWT-format anon/service-role keys; functionally identical, SDKs accept both. (3) Default ports 543xx collide when multiple workspace projects run locally — pick a per-project range.
context:
  tools: []
  languages: []
  platforms:
    - supabase
  tags:
    - supabase-cli
    - config-migration
    - publishable-key
    - port-allocation
    - multi-project
last_validated_at: "2026-05-20"
---
## Three symptoms after the bump

### 1 — verify_jwt schema rejection

After bumping supabase-cli, `supabase start` fails to parse the existing `config.toml`:

```
failed to parse config: decoding failed due to the following error(s):

'functions[verify_jwt]' expected a map or struct, got "bool"
Try rerunning the command with --debug to troubleshoot the error.
```

A Go stack-trace (~10 lines of `github.com/supabase/cli/...`) precedes the actual diagnostic. Scroll to the bottom for the real message.

### 2 — keys look different in `supabase status`

```
╭──────────────────────────────────────────────────────╮
│ 🔑 Authentication Keys                               │
├─────────────┬────────────────────────────────────────┤
│ Publishable │ sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH │
│ Secret      │ sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz      │
╰─────────────┴────────────────────────────────────────╯
```

No more `anon key: eyJhbGciOi...` / `service_role key: eyJhbGciOi...`. New format. SDKs (supabase-swift 2.46+, supabase-kt 3.x, supabase-js 2.x recent) accept both formats transparently — only the variable-name convention sticks (`SUPABASE_ANON_KEY = sb_publishable_*` is fine).

### 3 — port allocation collision in multi-project workspaces

```
failed to start docker container "supabase_db_taxray":
Error response from daemon: Bind for 0.0.0.0:54322 failed: port is already allocated
Try stopping the running project with supabase stop --project-id DepotApp
Or configure a different db port in supabase/config.toml
```

Triggered when two local supabase instances both default to the 543xx range.

## Fix all three

```toml
# supabase/config.toml — for project running parallel to a default-port instance

# Per-Function configuration (legacy global form was removed in supabase-cli 2.x)
[functions.eric-submit]
verify_jwt = true

[functions.gdpr-export]
verify_jwt = true

# Workspace port allocation: 544xx so this project runs parallel to the
# default-port (543xx) project — agree a convention per workspace.
[api]
port = 54421

[db]
port = 54422
shadow_port = 54420

[studio]
port = 54423

[inbucket]
port = 54424
```

Mobile/web clients update their endpoints accordingly:
- iOS Simulator: `http://127.0.0.1:54421` (host loopback works)
- Android Emulator: `http://10.0.2.2:54421` (magic IP for emulator-to-host)

Keys do not need code changes — `sb_publishable_*` works in any anon-key slot.

## Why functions/verify_jwt went per-function

The global form was always coarse — it forced every function in the project to share an auth posture. Real projects mix public functions (`stripe-webhook`, `email-confirmation-link`) with user-auth-gated functions (`get-private-data`). The per-function declaration matches what teams actually want; CLI 2.x removed the global to prevent the silent-misconfiguration class where new functions inherited a stale default.

## When this does NOT apply

- **You only use `supabase` cloud, not local CLI:** the config-schema break only affects `supabase start`. Cloud-side functions are configured per-function in the dashboard, no schema migration needed.
- **You run a single supabase project locally:** the port-collision symptom never fires. Stay on default 543xx.
- **You have one function and like the legacy form:** sorry, the global was removed. Even single-function projects need the per-function declaration now.
- **Your SDK predates the publishable/secret format:** very old supabase-js (≤ 1.x) and supabase-swift (≤ 2.20) may not accept the new key format. Use the legacy JWT keys instead, which the cloud dashboard can still issue via a settings toggle. The local CLI 2.x only emits the new format — there's no toggle for the local instance.

Related: [[lsn_supabase_secrets_set_project_ref_required]] — another supabase-CLI silent-misconfiguration pattern.

## Anti-patterns

- **Skipping the per-function declaration "because all my functions need verify_jwt":** the global is gone, no shortcut available. Declare each function.
- **Hardcoding `sb_publishable_*` keys in code anywhere they could be confused for secrets:** the `sb_publishable_` prefix is your safety label — preserve it in env-var values, log redaction rules, and review tooling.
- **Stopping a colleague's supabase instance to "free the port":** annoying. Use port-allocation per project. Document the assignment (e.g. `Meltemi=543xx, Midgard=544xx`) in the workspace README so it stays consistent.
- **Treating local + cloud as fungible during this transition:** cloud projects created before the publishable/secret rollout still show legacy keys by default. New projects show the new format. Always read what your dashboard actually says rather than assuming.

```js
search_lessons({ query: "supabase cli 2.x config.toml verify_jwt publishable key port collision", platforms: ["supabase"] })
```
