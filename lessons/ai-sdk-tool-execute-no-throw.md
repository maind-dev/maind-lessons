---
id: lsn_ai_sdk_tool_execute_no_throw
title: "Tool `execute` must never throw in a streaming chat loop — return fail-soft notes, gate registration on config"
type: workflow_best_practice
tier: community
summary: "In Vercel AI SDK streamText tool loops, a throw inside a tool's execute() surfaces as an `error` stream part and ends the step with no text — custom handlers then hit their degradation path (e.g. retry WITHOUT tools), losing every tool capability for the turn. Rule: every failure path returns a structured result with a `note` the model can react to; outer try/catch as last resort; don't register tools that structurally cannot succeed (missing env) — an uncallable tool degrades tool choice."
context:
  tools: []
  languages:
    - typescript
  platforms:
    - nextjs
  tags:
    - ai-sdk
    - tool-calling
    - streaming
    - error-handling
    - fail-soft
    - voice-assistant
---

## The failure chain a single throw triggers

A typical `streamText` route with tools and a custom NDJSON protocol:

```ts
const result = streamText({ model, system, messages, tools, stopWhen: stepCountIs(4) });
for await (const part of result.fullStream) {
  if (part.type === "text-delta") send({ t: "text", d: part.text });
  else if (part.type === "tool-result" && ...) { /* forward */ }
  else if (part.type === "error") toolErrored = true;   // ← a throw lands HERE
}
if (!sentText && toolErrored) {
  // degradation path: retry the whole turn WITHOUT tools
}
```

If a tool's `execute` throws (a DB client that failed to construct, an unhandled
fetch rejection, a parse error), the SDK emits an `error` part instead of a
`tool-result`. The step often ends with no text at all, so the handler's degradation
path fires — in this shape, a retry **without tools**. One unhandled exception in one
tool silently costs the ENTIRE turn its tool capabilities (navigation, search,
grounding), and the user just gets a vaguer answer with no visible error.

## The three-part rule

1. **Every failure path returns a structured result, not a throw.** Include a `note`
   string that tells the model what happened and what to do instead — it can react
   in-turn:

   ```ts
   if (!configured) return { hits: [], note: "Codebase search is not configured — answer from wiki/context instead." };
   if (!embedding)  return { hits: [], note: "Search backend unreachable — say grounding was unavailable." };
   ```

2. **Outer try/catch as the last resort.** Anything you didn't anticipate (client
   construction, JSON parsing) still becomes a note, never a throw:

   ```ts
   export async function searchFusion(q: string) {
     try { return await searchFusionInner(q); }
     catch (err) { console.error(err); return { hits: [], note: "Unexpected search error — answer without grounding." }; }
   }
   ```

3. **Don't register structurally dead tools.** If required env/config is missing,
   omit the tool from the tools object entirely (spread-conditional) instead of
   registering one that always fails — a permanently failing tool wastes steps and
   skews the model's tool choice:

   ```ts
   ...(hasCodebaseSearch() ? { search_codebase: tool({ ... }) } : {})
   ```

## Verification

Degradation probe: remove the tool's backing config/endpoint, ask a question that
would normally trigger it. Expect a coherent (if less grounded) answer and NO error
event in the stream; with config restored, the tool result flows again.

## When this does NOT apply

- Frameworks/handlers that catch tool errors per-call and feed them back to the model
  as tool-error messages by design — there a throw IS the structured channel. Check
  what your stream handler actually does with `error` parts before assuming.
- Genuine programmer errors you want loud in development — keep them loud in tests,
  but the production execute path should still degrade to a note.
- Non-streaming, single-shot generateText calls where you handle the rejection at the
  call site anyway.

## Related

- [[lsn_mcp_response_chain_hints]] — same philosophy one layer down: put actionable
  guidance in the RESPONSE the model actually sees, not in out-of-band channels.

```ts
search_lessons({ query: "ai sdk tool execute throw error stream fallback without tools", limit: 5 })
```
