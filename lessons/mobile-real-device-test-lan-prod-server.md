---
id: lsn_mobile_real_device_test_lan_prod_server
title: "Test a mobile-only bug on a real phone via a LAN production server when preview deploys are auth-gated"
type: workflow_best_practice
tier: community
context:
  tools: [nextjs, vercel]
  languages: []
  platforms: [web, ios, android]
  tags: [mobile-testing, vercel-preview, lan, dev-vs-prod, real-device]
summary: "A bug that only reproduces on a real mobile GPU/engine (not desktop, not a resized window, not DevTools emulation) needs a real device — but Vercel Preview deploys sit behind Deployment Protection (login wall on the phone) and the dev server is confounded by StrictMode/Fast-Refresh. Serve a PRODUCTION build on the LAN (next start -H 0.0.0.0) and open it from the phone over the same WiFi: real device, real prod build, no auth."
last_validated_at: "2026-06-25"
---

## The problem

Some bugs only appear on a **real mobile device** — a mobile GPU losing a WebGL context, a WebKit-only filter/clip glitch, a touch-only layout issue. A resized desktop window and DevTools device-emulation do NOT reproduce them (same engine family, not the mobile GPU/DPR). You need the actual phone, but the two obvious paths fail:

1. **Vercel Preview URLs are auth-gated.** With Deployment Protection on, the phone (not logged into Vercel) gets a login wall — "this page couldn't load".
2. **The dev server lies.** `next dev` runs React StrictMode (double-mount) + Fast Refresh, which can fake crashes that don't exist in production (see the related lesson) — not a fair test.

## The fix: a LAN production server, hit from the phone

Build for production and serve it bound to all interfaces, then open it from the phone on the **same WiFi**:

```bash
next build
next start -H 0.0.0.0 -p 3001        # bind to the LAN, not just localhost
ipconfig getifaddr en0               # macOS: your Mac's LAN IP, e.g. 192.168.0.220
# On the phone (same WiFi):  http://192.168.0.220:3001
```

This is a **production** build (no StrictMode), reachable **without any auth**, on the **real device**. Verify it serves on the LAN before blaming the phone:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.0.220:3001/   # expect 200
```

## Gotchas (when the phone "can't load" but the server is up)

- **Same network.** The phone must be on the same WiFi subnet as the Mac — not cellular, not a separate guest SSID. Check the phone's IP is also `192.168.0.x`.
- **iOS iCloud Private Relay / "Limit IP Address Tracking"** routes Safari traffic and can block LAN IPs → turn it off for that WiFi (Settings → WiFi → ⓘ), or use another browser.
- **Router AP/client isolation** (common on guest networks) blocks device-to-device traffic → use the main network.
- **macOS firewall** may prompt once to allow incoming connections for `node` — allow it (or it's off entirely).

## Reading the phone's console

- iOS: Safari Web Inspector — Mac Safari → Develop → <your iPhone> → the tab.
- Android: Chrome `chrome://inspect`.
- Or reproduce in a **narrow desktop window** for full DevTools if the bug is breakpoint-debuggable — but confirm the final verdict on the real device, since GPU/engine-specific bugs only show there.

## Alternative

Disable Vercel **Deployment Protection** for Preview deployments (Project → Settings → Deployment Protection) so the preview URL is public — then any device loads it over the internet, no LAN/WiFi constraint.

## When this does NOT apply

- The bug reproduces on desktop or in DevTools device emulation — no real device needed.
- Preview deploys are already public — just open the preview URL on the phone.
- Native apps (not web) — use the platform's device/simulator tooling instead.

Related: `lsn_react_strictmode_dev_resource_churn_diagnose_on_prod_build` — WHY the dev server isn't a fair test (StrictMode double-mount). Cross-ref: [[lsn_next_dev_hostname_hang]] — a different `next dev` hostname/binding gotcha on macOS.