---
id: lsn_mcp_response_chain_hints
title: Tool-chain hints belong in MCP responses, not only in static tool descriptions
type: workflow_best_practice
tier: community
summary: Static MCP tool-descriptions are first-loss candidates under client-side context-compaction. Cross-tool follow-up hints ("call X next") survive compaction reliably only when they live as structured fields in the response — stage + tool + note + required_fields — and adapt to the caller's plan tier so free-plan users get an actually-callable fallback instead of a referenced-but-gated tool.
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  languages:
    - typescript
  platforms:
    - mcp
  tags:
    - mcp
    - tool-chaining
    - context-compaction
    - tier-gating
    - server-design
last_validated_at: "2026-05-28"
---

## The failure mode this fixes

A common MCP-server pattern is to put "When X happens, call tool Y next" guidance into the **static tool description** that the client sees during the `tools/list` handshake. This works on a fresh conversation. It stops working once the client compacts context — and most production agent harnesses compact aggressively. Tool descriptions are routinely among the first content blocks dropped or summarized, because they look reference-y and stable from the client's heuristics. This pairs with the cost lever explored in [[lsn_claude_md_structure]] — context-window economy applies to tool descriptions too, and the moment they get summarized your cross-tool guidance is gone.

Live-observed: an MCP server returned `recommend_handoff({advisory: "warn", next_action: "wrap_up_current_subtask"})` to a Claude agent mid-session. The static tool description said "When advisory is 'handoff_recommended', call `generate_handoff_brief` next (Pro plan)". After ~85k tokens of session history, the agent did NOT call the brief tool when the advisory escalated; it only mentioned the wrap-up text. Manual user prompt was needed to trigger the brief. The cross-tool hint had been silently lost.

## The pattern: structured chain-hint field in the response

Add a structured `chain_hint` (or `next_tool_hint`) field directly in the tool's response JSON, with these properties:

```ts
interface ToolChainHint {
  stage: "prepare" | "call_now" | "manual" | "fallback";
  tool?: string;
  note: string;
  required_fields?: string[];
  suggested_args?: Record<string, unknown>;
  required_plan?: "solo_pro" | "team" | "enterprise";
  upgrade_url?: string;
}
```

Stages:

- `prepare`: a wrap-up signal arrived; the agent should start collecting inputs for the eventual follow-up tool, but call timing is not now.
- `call_now`: call the named `tool` with the collected fields immediately.
- `manual`: the agent cannot delegate to a server-side follow-up tool (e.g. tier-gated, or out of scope) — it should compile output itself, using `required_fields` as the structural template.
- `fallback`: the original tool isn't available to this caller (plan-gated), but a tier-available alternative is named. Use the alternative.

`required_fields` is the killer feature here. When a follow-up tool needs specific inputs (e.g. a handoff brief needs `focus`, `recent_decisions`, `open_threads`, `next_steps`), naming them in the response — at the moment a `warn`-style advisory fires — lets the agent **pre-collect** them across the next several turns. The eventual `call_now` is then one roundtrip away instead of "wait, what fields again?". Pre-warming at the **warn** threshold (e.g. 60% of a token budget) instead of waiting for the critical threshold (e.g. 85%) spreads the cognitive load across multiple turns — at the critical threshold the agent has minimal remaining capacity to reflect on session state and compile structured fields cleanly.

## Tier-awareness: server branches, plan-gate failures standardize

The MCP server already knows the caller's plan tier (authoritative via the auth/verify cache). Use it. Branch the hint server-side based on plan:

- Paid plan + non-`ok` advisory → `tool` is the real follow-up tool, `stage` reflects the advisory (`prepare` / `call_now`).
- Free plan + non-`ok` advisory → no `tool` reference (the follow-up tool is gated), `stage: "manual"`, `required_fields` still listed so the agent compiles its own output. `required_plan` + `upgrade_url` added as an honest signal.

Anti-pattern: "always name the paid tool with a `(Pro)` suffix". The free-plan agent reads a tool name it cannot call — the hint is dead weight, and worse, it can mislead the agent into telling the user "I'm calling X" when X will be rejected. Server-side branching produces a hint that is actually actionable for every caller.

Plan-gate failures (calling a paid-only tool from a free key) are the same problem in a different uniform. Different MCP servers ship inconsistent shapes for the same failure — JSON with `isError: true`, plain text with `isError: false`, bespoke `submit_error`-style JSON. Consolidate them under one shape — same `chain_hint` pattern works:

```json
{
  "ok": false,
  "error": "requires_pro",
  "message": "list_templates is a Pro-plan feature. Upgrade at <pricing>.",
  "hint": "Fallback available: call search_lessons (Community-tier lessons cover many setup patterns).",
  "upgrade_url": "https://...",
  "chain_hint": {
    "stage": "fallback",
    "tool": "search_lessons",
    "note": "Community-tier lessons cover many setup patterns.",
    "suggested_args": { "tier": "community", "limit": 5 },
    "required_plan": "solo_pro",
    "upgrade_url": "https://..."
  }
}
```

Setting `isError: true` is the correct semantic — a plan-gate failure IS a tool error from the client's perspective. Some implementations historically got this wrong (returning `isError: false` with a free-tier explanation in the text body); this is a UX bug, not a polite fallback. Also use `_metering_count: 0` + `_metering_error: true` so the failure isn't billed as a successful tool call.

## Why structured hints, not auto-trigger or pure descriptions

A tempting alternative: have the server automatically initiate the follow-up tool call when conditions are met. Don't. MCP is reactive by design — the server responds to client calls, it does not push its own. Auto-trigger violates the protocol and takes agency away from the agent. The structured hint in the response is the right layer: the agent sees a concrete next step, fields to collect, and stage timing; the decision to follow stays with the agent.

A second alternative: keep relying on tool descriptions but make them shorter/punchier. This helps marginally (less to compact) but doesn't solve the underlying problem — descriptions still get summarized, and a summary of "call generate_handoff_brief next" can collapse into nothing actionable. Responses are part of the conversation history that the client actively manages; descriptions are reference material the client treats as droppable. Use the channel that the client preserves.

## Backward-compatibility during migration

Existing callers may read the old shape (a bare string `next_action`, an unstructured `next_tools_to_try` array). Keep them as deprecated aliases parallel to the new `chain_hint`/`chain_hints` field for at least one server-major. Document the removal in the changelog. Skipping the alias period silently breaks client-side dashboards that scrape the old fields. Tests over every `(plan × advisory)` cell catch silent matrix flips during future refactors. An integration test that walks "agent receives `prepare`-stage hint, on the next call receives `call_now`, and actually invokes the named tool with the named fields" is the highest-value coverage you can write.

## When this does NOT apply

- **Single-tool servers.** If your MCP server has one tool, there is no chain. Skip the pattern.
- **Stateless workflows with no advisory triggers.** Pure data-fetch tools (search-by-id, get-by-id) don't have a moment where "now call Y" is the right next move; their responses should carry data, not workflow guidance.
- **Pre-call validation steps.** Schema validation that runs before a real tool call returns errors via a structured failure shape; it doesn't need a chain hint because the agent already knows the next step is "fix and retry".
- **Tools whose follow-up is unconditional.** If "call X then always call Y" is universally true, that's a server-side composition concern — combine X and Y into a single tool, don't surface the composition through a chain hint.
- **Servers where the client is known to NOT compact (or where the description IS shown verbatim in every turn).** The pattern's value is in compaction-robustness; if your client doesn't compact, the description channel is fine. Validate this assumption with a long-session field test — many clients claim "no compaction" but do summarize implicitly past a threshold.

See also [[lsn_effort_level_doc_in_session_notes]] for the related pattern of surfacing structured fields (estimated / used / actual) in session notes — same idea applied to a different artifact: structured fields beat free-form prose when downstream consumers (next session, future you, or another agent) need to act on them mechanically.
