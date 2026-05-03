---
id: lsn_0001_next_dev_hostname_silent_hang
title: "next dev silently hangs after network change (default 0.0.0.0 bind)"
type: debugging_lesson
tier: community
context:
  tools: [next, claude-code]
  languages: [typescript]
  platforms: [macos, linux]
  tags: [dev-server, network, networking]
summary: "Next.js dev server appears to start (port log printed) but never responds to localhost requests — frequent after switching networks, VPN connect/disconnect, or laptop sleep/wake."
problem: |
  After switching networks (e.g. office WiFi ↔ home, or VPN connect),
  `pnpm dev` (or `next dev`) prints the usual "ready in Xms" + port banner
  but http://localhost:3000 never responds — curl hangs, browser shows
  ERR_EMPTY_RESPONSE. No error in the dev-server console. Killing and
  restarting reproduces the same hang. Reverting the network change
  (back to the original WiFi) often makes it work again.
solution: |
  Pin the dev server to the loopback interface explicitly:

  1. Edit `package.json`:
     ```json
     {
       "scripts": {
         "dev": "next dev --hostname 127.0.0.1"
       }
     }
     ```
  2. Restart `pnpm dev`. Subsequent network changes no longer matter.

  Why: Next.js dev defaults to binding `0.0.0.0` (all interfaces). When the
  active network interface changes, the bound socket can become orphaned
  on the previous interface IP without an OS-level signal Next.js could
  catch. `127.0.0.1` is interface-independent and stable across network
  transitions.
gotchas:
  - "Restarting `pnpm dev` without changing the bind hostname only works until the next network change."
  - "Hard-killing the node process and restarting the same script: same outcome — the issue is the bind, not stuck state."
  - "Switching browsers / clearing the browser cache: doesn't help — connection never reaches the dev server."
evidence: "Reproduced on Next.js 15.x and 14.x, macOS 14/15. Same pattern on Linux behind WireGuard VPN connect/disconnect."
last_validated_at: "2026-05-03"
tool_versions:
  next: "15.x"
upvotes: 0
---

# Background

This is a classic "the dev server says it's listening but isn't" symptom that costs a lot of head-scratching the first time you hit it. The `0.0.0.0` default behaviour is fine on a stable network but degrades silently when interfaces come and go.

For a coding agent: if a user reports "I started the dev server but localhost doesn't respond" and they recently changed networks, jumped on/off VPN, or woke from sleep — try the `--hostname 127.0.0.1` fix before going down deeper rabbit holes (port conflict, firewall, IPv6 issues, etc.).

## When NOT to apply this fix

- If you actually need the dev server reachable from another device on your LAN (mobile testing), use `--hostname 0.0.0.0` and accept the fragility, or use `--hostname <your-stable-LAN-IP>`.
- If the symptom is "port already in use" rather than "hangs silently", this is a different problem.

## Related

- `next dev` flags reference: https://nextjs.org/docs/app/api-reference/cli/next#next-dev-options
