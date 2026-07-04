---
id: lsn_mcp_stale_tool_discovery_phantom_success
title: Reconnect the MCP client after a server version bump — a stale tool-list makes the agent narrate phantom success
type: workflow_best_practice
tier: community
summary: Tools added in a new MCP server version are invisible to a client that connected before the bump until it re-initializes. The agent may report ok:true for a tool that is not actually in its tool-list — a phantom success with zero side-effect. Verify the tool is listed AND verify side-effects against ground truth, never the return value alone.
context:
  tools: [claude-code, cursor, windsurf, claude-desktop]
  languages: []
  platforms: []
  tags: [mcp, tool-discovery, verification, hallucination, agent-behavior]
---

## The failure mode

An MCP server adds new tools in a version bump (e.g. v0.4.x → v0.5.0). A client session that established its connection *before* the bump holds a stale `tools/list` — the new tools are simply absent from the model's available-tool set. When the user then asks the model to use one of those tools, the model — "knowing" a tool that should exist but which is not actually callable — may narrate a plausible success (`ok:true`, `status:"withdrawn"`) instead of failing. No tool call crosses the wire, so there is **zero side-effect**, yet the transcript reads like success.

This is distinct from "the tool ran but the change did not land" (see [[lsn_postgres_verify_live_function_body]], [[lsn_supabase_phantom_migrations]]). Here the tool **never ran at all**.

## Symptom

| Observation | What it means |
|---|---|
| Agent reports `ok:true` / success, but the persistent store (DB, file, remote) is unchanged | Suspect the call never executed |
| The "used" tool was added in a recent server version | Strong signal: stale tool-discovery |
| A second path (dashboard button, fresh client) performs the same action and it persists | Backend is fine; the MCP client was the gap |

## Root cause

The MCP client builds its tool list at connection/initialization time. A server-side version bump that registers new tools does **not** retroactively push into already-open clients. Until the client re-initializes, `tools/list` is stale and the new tools are uncallable.

## The fix

Reconnect / re-initialize the MCP client after any server version bump, so `tools/list` is rebuilt. Then confirm the tool is actually present before relying on it:

- Call the server's identity/health tool (e.g. a `verify_setup`-style endpoint) — check `server.version` matches the expected post-bump version AND that the new tool name appears in your available-tool set.
- If the tool is absent: that *is* the bug. No prompt-engineering works around a missing tool — only a reconnect does.

## Non-destructive correctness probe

Before trusting a mutation tool, prove it reaches the real backend without mutating anything: call it against a record already in the terminal state the tool would move it to. A correct, prod-connected tool returns a benign refusal:

```
withdraw_content_draft({ draft_id: "<already-withdrawn-id>" })
→ { ok:false, error:"not_withdrawable", hint:"...this one is withdrawn" }
```

That refusal proves three things at once: the tool is listed, it reads the real backend, and it does not mutate. If you instead get `ok:true` on an already-terminal record, no real call happened — the success is narrated, not executed. The discipline generalizes: never treat a tool's `ok:true` as proof of a side-effect — verify against ground truth (query the DB, re-read the file, re-fetch the resource). This composes with [[lsn_agent_self_report_over_llm_judge]]: the agent's self-report is a starting point; mechanical ground-truth is the proof.

## When this does not apply

- Tools that exist but fail server-side (auth, rate-limit, schema mismatch) — those return real errors, not phantom success.
- Deferred / lazy tool discovery (tool-search style) where tools load on demand — a different mechanism; this reconnect fix is specific to connection-time tool-list staleness after a version bump.
