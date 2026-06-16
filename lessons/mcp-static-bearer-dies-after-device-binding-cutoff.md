---
id: lsn_mcp_static_bearer_dies_after_device_binding_cutoff
title: "Fix an MCP server that loads zero tools after device-binding enforcement (401 invalid_or_device_required)"
type: debugging_lesson
tier: community
context:
  tools: [claude-code, cursor, windsurf, codex]
  languages: []
  platforms: [mcp]
  tags: [mcp, authentication, device-binding, api-key, bridge, tools-not-loading]
summary: "An MCP server in direct mode (static `Authorization: Bearer <key>` over HTTP) silently stops working once the provider enforces device-binding on paid tiers: the client shows 'failed to connect' and loads ZERO tools, so the agent acts as if the server were absent. The 401 hint `invalid_or_device_required` is the tell — a static header can't send a device id. Fix: switch to the provider's device-binding bridge launcher (browser-pairs + mints a device-bound key), then restart the client."
last_validated_at: "2026-06-15"
---

## The symptom

An MCP server that used to work is suddenly gone. The agent behaves as if the
server were never configured — none of its tools appear in the tool list, and
the model silently falls back to acting without them. A health check shows:

```
maind: https://mcp.maind.dev/mcp (HTTP) - ✗ Failed to connect
```

Nothing in the agent's own logs explains it; the tools are simply absent. This
is the dangerous part: a connection failure presents as *silence*, not an error
the agent surfaces mid-task.

## The cause

The server is configured in **direct mode** — a static credential on an HTTP
transport:

```json
{ "maind": { "url": "https://…/mcp",
             "headers": { "Authorization": "Bearer <key>" } } }
```

The provider has since introduced **device-binding enforcement** for paid tiers
(a dated cutoff). After the cutoff the key must be presented together with a
per-device id; a static header has no way to attach one. Probing the endpoint
directly reveals the real reason behind the generic "failed to connect":

```
HTTP 401  {"error":{"message":"Invalid or revoked API key (invalid_or_device_required)"}}
```

The hint `invalid_or_device_required` (no device id supplied) is the tell: the
key isn't necessarily revoked — the request is missing the device dimension the
server now requires. The agent client only saw "auth failed → drop the server",
so it loaded zero tools and moved on.

## The fix: migrate to the device-binding bridge

Replace the static-header HTTP entry with the provider's **bridge launcher** — a
stdio `command`/`args` entry that handles browser-pairing and mints a
device-bound key on first launch:

```json
{ "maind": { "command": "npx",
             "args": ["-y", "@maind-dev/mcp-bridge"],
             "env": { "MAIND_MCP_URL": "https://mcp.maind.dev/mcp" } } }
```

Most providers ship a one-shot installer that writes this block and pairs in the
same step (here: `npx -y @maind-dev/mcp-bridge install`). If the device was
already approved, the bridge signs in immediately and caches the device-bound
key; otherwise it prints a short code to approve in the browser.

## Two things that waste time if you miss them

- **A live session will not pick up the new server.** MCP servers are
  initialised at client start, so after migrating you must restart the client
  before the tools appear. (If you must act within the current session, you can
  drive the server over the bridge via raw MCP stdio: `initialize` →
  `notifications/initialized` → `tools/call`.)
- **"Failed to connect" hides the reason.** Don't assume a revoked key — probe
  the endpoint (`curl`/a one-line POST) and read the 401 body. A
  `device_required` / `device_mismatch` hint means *migrate to the bridge*, not
  *mint a new static key* (a fresh static key hits the same wall on paid tiers).

## Generalises to

Any MCP server (or similar token-authenticated long-lived connection) where the
provider adds device-binding after you first configured a static credential. The
signature is always the same: tools silently vanish, health shows "failed to
connect", and the 401 body — not the client log — carries the actual reason.
