---
id: lsn_voice_agent_citation_chips
title: "Voice-agent citations belong in UI chips fed by a stream side-channel — never in the spoken LLM text"
type: workflow_best_practice
tier: community
summary: "A grounded voice assistant needs verifiable citations, but TTS reading ids/lists/scores aloud is unusable, and LLM-paraphrased ids drift. Split the channels: the model speaks a short conclusion (at most 1-2 names, never ids/lists/scores); the server forwards tool results as a structured stream event (field-whitelisted, capped); the client narrows the payload, merges multi-step results, and renders citation chips whose tooltips carry the exact server-validated ids."
context:
  tools: []
  languages:
    - typescript
  platforms:
    - nextjs
  tags:
    - voice-assistant
    - tts
    - citations
    - streaming
    - tool-calling
    - ui
---

## The tension

Grounded answers should be citable — which symbol, which document, which lesson. But
a voice assistant's reply is read aloud: ids like `lsn_postgres_strict_mode`,
qualified names with line numbers, or similarity scores are unlistenable, and asking
the model to "mention the id" invites a second failure — LLM-paraphrased ids drift
(rewritten casing, invented suffixes) and stop being look-up-able.

## The pattern: two channels with different jobs

**Spoken channel (LLM text):** the system prompt pins the discipline — short
conclusion, at most one or two symbol/document names said naturally, NEVER lists,
ids, paths, line numbers, or scores. Repeat the same rule in the tool result's
`note` and the tool description: the model needs to hear it at decision time, not
only in the system prompt.

**Citation channel (structured stream event):** the chat route forwards the tool
result as its own event in the streaming protocol, e.g.

```jsonc
{"t":"sources","kind":"codebase","code":[{"name":"…","qualified_name":"…","kind":"function","start_line":42,"label":null}],"lessons":[{"id":"lsn_…","title":"…"}]}
```

Three rules make it safe and cheap:

- **Server-side field whitelist + caps** (e.g. 5 code hits, 3 documents) — internal
  hashes/scores never reach the client; forward only when there is something to cite.
- **Client-side narrowing again** (never trust wire data), plus a merge for
  multi-step tool loops: dedupe by stable key (qualified_name / id), keep the caps.
- **Attach before any deferred reveal.** If the UI holds the reply behind a skeleton
  until TTS starts, attach sources to the pending message with a spread-preserving
  update so they survive the reveal; render chips only once the text shows.

**Rendering:** a chip row under the assistant message (`aria-label="Sources"`):
mono chips for code symbols (tooltip = `qualified_name:line`), styled chips for
documents/lessons (tooltip = the exact id). The tooltip carries the verifiable id
verbatim — copyable, never spoken.

## Why not just let the model cite in text

- TTS discipline: spoken lists/ids destroy the conversational quality the voice UI
  exists for.
- Reliability: chips carry ids the SERVER validated from the tool result; the model
  cannot misquote them.
- Consistency: the same reply renders well in text view and voice view without
  post-processing the transcript.

## When this does NOT apply

- Text-only chat UIs — inline markdown citations are fine there (though the
  structured-sources event still beats parsing citations out of prose).
- Tools whose output IS the answer (a single navigation target, a computed number) —
  nothing to cite separately.
- Fully unauthenticated/no-grounding assistants with no tool results to attribute.

## Related

- [[lsn_ai_sdk_tool_execute_no_throw]] — the fail-soft rules for the same tool loop;
  a sources event only exists when the tool result does.
- [[lsn_mcp_response_chain_hints]] — structured response fields beat prose for
  anything a downstream consumer must act on mechanically; this is the UI variant.

```ts
search_lessons({ query: "voice assistant citations tts chips sources stream event", limit: 5 })
```
