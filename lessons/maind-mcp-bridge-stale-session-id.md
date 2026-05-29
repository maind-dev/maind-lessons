---
id: lsn_maind_mcp_bridge_stale_session_id
title: Fix maind MCP bridge stale-session failures before debugging auth
type: debugging_lesson
tier: community
context:
  tools: [codex]
  languages: [typescript]
  platforms: [mcp]
  tags: [mcp, streamable-http, session-id, troubleshooting, codex]
summary: If maind MCP tools fail with `no valid session ID and not an initialize request`, first separate bridge/server/auth health from the IDE's stale MCP transport. A manual initialize/tools-list check can prove maind works; then kill stale bridge processes and reload the IDE window.
problem: |
  maind MCP tool calls from Codex failed with:

  `Bad Request: no valid session ID and not an initialize request`

  The same session then reported `Transport closed` after stale bridge processes were terminated. The error looked like an auth or server problem, but the underlying issue was the active IDE MCP transport holding stale tool metadata while the remote Streamable-HTTP session was no longer valid.
solution: |
  Diagnose the layers in this order:

  1. Run `verify_setup` from the IDE. If it fails with the same session-id error, do not assume the API key is bad yet.
  2. Manually test the bridge with an MCP `initialize` frame followed by `notifications/initialized` and `tools/list` against the same `MAIND_MCP_URL`.
  3. If the manual bridge test succeeds, maind server, API key, device binding, and bridge package are healthy. The problem is the IDE's currently held MCP transport.
  4. Inspect running bridge processes and terminate only stale maind bridge pairs, for example `npm exec @maind-dev/mcp-bridge` plus its child `maind-mcp-bridge` process.
  5. Reload the IDE window so the MCP client sends a fresh `initialize` and receives a new `Mcp-Session-Id`.
  6. Re-run `verify_setup`; it should report `status: connected`.

gotchas:
  - "`no valid session ID` is a transport/session error, not automatically an auth error. Re-auth is unnecessary if a manual initialize succeeds."
  - "After killing the stale bridge, `Transport closed` can be expected until the IDE reloads and reinitializes the MCP server."
  - "Do not kill arbitrary Node processes. Match only the maind bridge command and its direct npm wrapper."
  - "Multiple bridge processes under the IDE parent are a strong signal that old transports were not cleaned up."
evidence: "Observed with Codex, @maind-dev/mcp-bridge 0.1.1, and maind MCP server 0.1.8 on 2026-05-25. Manual initialize/tools-list succeeded; IDE tool calls recovered after terminating stale bridge processes and reloading the window."
last_validated_at: "2026-05-25"
---

## Manual bridge check

Use the same endpoint and client-family that the IDE config uses. The exact API key remains in the bridge cache; do not paste secrets into the command.

```bash
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual-maind-check","version":"0.0.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | MAIND_CLIENT_FAMILY=codex \
    MAIND_MCP_URL='https://mcp.maind.dev/mcp?stack=typescript,nextjs,pnpm&intent=mixed' \
    npx -y @maind-dev/mcp-bridge
```

A healthy result returns an `initialize` response with server info and then a `tools/list` response. If this works while IDE tool calls fail, the fix is to refresh the IDE MCP transport, not to change maind server code.

## Recovery sequence

```bash
ps aux | rg 'maind-dev/mcp-bridge|mcp-bridge|node .*maind' | rg -v rg
# Carefully kill only the stale maind bridge npm wrapper + child node process.
```

Then reload the editor window. In VS Code, `Developer: Reload Window` is enough. Once the window reloads, call `verify_setup` again and confirm the account, server version, stack, and intent.

## When this does not apply

This convention applies when the manual bridge initialize succeeds. If the manual bridge check fails with `401`, `device_mismatch`, `device_revoked`, or `device_required`, follow the bridge reauthorization path instead. If it fails with network errors, debug proxy/DNS/connectivity before touching IDE state.

## Tool-use trigger

When an agent sees this symptom, it should first verify the current connection:

```json
verify_setup({})
```

If `verify_setup` itself fails with the session-id error, run the manual bridge check above before recommending reauthorization.