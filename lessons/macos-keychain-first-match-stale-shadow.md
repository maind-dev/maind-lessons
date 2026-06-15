---
id: lsn_macos_keychain_first_match_stale_shadow
title: "Diagnose stale macOS Keychain reads — `security -s` returns the first item, shadowing the fresh per-account token"
type: debugging_lesson
tier: community
summary: "`security find-generic-password -s <service>` returns only the FIRST matching Keychain item. When an app keeps several items under one service name (a legacy account-less one PLUS a fresh per-account one), the lookup can return a STALE token that shadows the valid one — your tool 401s while the app itself works fine. Fix: read with `-a <login-user>` or enumerate all matching items and pick the latest-expiry token."
context:
  platforms: [macos]
  tags: [macos, keychain, credentials, oauth, companion-tools, debugging]
---

## Symptom

A companion/tracker tool that reads another app's OAuth token from the macOS
Keychain suddenly shows expired/empty data (a usage bar stuck at 0%, or a 401
from the API) — **even though the host app itself is logged in and working
fine**. Re-logging in the host app doesn't fix your tool. Multiple independent
third-party tools may break at the same time, which falsely looks like "the
vendor killed third-party access."

## Root cause

`security find-generic-password -w -s "<service>"` returns the **first**
generic-password item that matches the service — not "the" item. macOS lets
several items share one service name, distinguished by their `account` (`acct`)
attribute. Apps that refactor credential storage (multi-account support, moving
off plaintext) often start writing a NEW item keyed to an account (commonly the
login user, `$USER`) while leaving the OLD account-less item (`acct=<NULL>`)
behind, un-migrated. The bare `-s` lookup can return the stale legacy item,
**shadowing** the fresh per-account token.

Concrete case (Claude Code 2.1.x, verified 2026-06): two `Claude Code-credentials`
items existed — `acct=<NULL>` (expired yesterday) and `acct=alex` (`$USER`,
written today, valid). A tool reading via `-s` only got the dead one → its usage
API call 401'd → "0%". The valid token sat right there under `$USER`.

Methodology: when several independent tools break at once, the reflex "the vendor
cut us off" is usually wrong. Before concluding upstream-dead, run
`search_lessons({ platforms: ['macos'], tags: ['keychain'] })`, then read a
still-working **open-source** competitor's credential-loading code — it often
already encodes the workaround (here: the open-source Claude-God app's "scan all
matching keychain items" fallback pointed straight at the fix).

## Detection

```bash
# What the naive lookup returns (may be the stale item):
security find-generic-password -s "<service>" | grep -E "acct|mdat"

# Target the login-user account explicitly (often the fresh one):
security find-generic-password -s "<service>" -a "$(whoami)" | grep -E "acct|mdat"

# Enumerate ALL items under the service + their account/last-modified:
security dump-keychain 2>/dev/null | awk '
  /"acct"<blob>=/    {acct=$0}
  /"mdat"<timedate>=/{mdat=$0}
  /"svce"<blob>="<service>"/ {print "---"; print acct; print mdat}'
```

Two items with the same service but different `acct` and very different `mdat`
= the shadowing problem.

## Fix

Read **every** candidate item and pick the freshest by token expiry — don't
trust the first `-s` match.

```ts
// Read the user-account item AND the service-only item, parse both,
// keep the one with the latest expiry.
const cmds = [
  `security find-generic-password -w -s "${SERVICE}" -a "${os.userInfo().username}"`,
  `security find-generic-password -w -s "${SERVICE}"`,
];
const found = [];
for (const c of cmds) {
  try { const t = parse(execSync(c).toString()); if (t) found.push(t); } catch {}
}
const token = found.sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0))[0];
```

For full robustness (apps may key items by a hash of a config dir, not just
`$USER`), enumerate all `"<service>"` items from `dump-keychain` rather than
guessing the account. Verify by hitting the API with the picked token — a `200`
with real data confirms you read the live item, not the shadow.

## When this does NOT apply

- Linux: credentials live in a file (e.g. `~/.config/<app>/credentials.json`),
  not the Keychain — no multi-item shadowing, but check for stale copies.
- Single-item services: if the app only ever writes one item, `-s` is fine.
- If the API 401s with the *freshest* item too, the token really is revoked —
  that's an auth/policy problem, not shadowing.
