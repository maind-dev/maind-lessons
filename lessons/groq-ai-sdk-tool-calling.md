---
id: lsn_groq_ai_sdk_tool_calling
tier: community
title: "Fix `tool_use_failed` from Groq via the Vercel AI SDK — use a tool-reliable model and .chat()"
type: debugging_lesson
summary: "Two gotchas when wiring Groq through the Vercel AI SDK (@ai-sdk/openai) for tool/function-calling: (1) llama-3.3-70b-versatile frequently returns tool_use_failed the moment it needs a tool, so the stream ends with no text; switch to a tool-reliable Groq model. (2) The default provider(model) call targets OpenAI's Responses API which Groq does not implement — use .chat(model) for /chat/completions."
context:
  tools: []
  languages: ["typescript", "javascript"]
  platforms: ["groq"]
  tags: ["groq", "vercel-ai-sdk", "tool-calling", "function-calling", "llm"]
last_validated_at: "2026-06-11"
---

## The symptom

You point the Vercel AI SDK at Groq for an agent with tools, and the first
tool-free turn works — but the moment the model needs a tool, the stream dies
with no text. The `fullStream` carries an error part:

```
{ type: "invalid_request_error", code: "tool_use_failed",
  message: "Failed to call a function. Please adjust your prompt." }
```

`streamText` ends, your client gets zero text deltas, and the user sees "no
answer" — but only on turns that trigger a tool.

## Fix 1: use `.chat()`, not the default provider call

`@ai-sdk/openai`'s default call signature targets OpenAI's **Responses API**,
which Groq does NOT implement (only `/chat/completions`). Select the chat
endpoint explicitly:

```ts
import { createOpenAI } from "@ai-sdk/openai";

const groq = createOpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// groq(model)        -> targets the Responses API (not on Groq)
// groq.chat(model)   -> /chat/completions
const model = groq.chat("qwen/qwen3-32b");
```

## Fix 2: pick a model that actually tool-calls on Groq

`tool_use_failed` is model-specific — the model emits malformed tool-call JSON.
Tested against a real two-tool agent (mid-2026); models change, so re-verify:

| Groq model | Tool-calling |
|---|---|
| llama-3.3-70b-versatile | fails (tool_use_failed) |
| openai/gpt-oss-20b | empty |
| qwen/qwen3-32b | reliable (good multilingual) |
| llama-3.1-8b-instant | reliable (fast) |
| openai/gpt-oss-120b | reliable (verbose) |

Keep the model in an env var so you can swap it without a deploy.

## Defense: a no-tools fallback so a failure never yields an empty answer

Even with a good model, make the turn resilient: if the tool stream errors with
no text, retry once WITHOUT tools so the user still gets a reply.

```ts
let sentText = false, toolErrored = false;
for await (const part of result.fullStream) {
  if (part.type === "text-delta") { sentText = true; send(part.text); }
  else if (part.type === "error") toolErrored = true;
}
if (!sentText && toolErrored) {
  const fb = streamText({ model, system, messages }); // no tools
  for await (const p of fb.fullStream)
    if (p.type === "text-delta") send(p.text);
}
```

## When this does NOT apply

- Native OpenAI (the Responses API exists there) or the dedicated `@ai-sdk/groq`
  provider — though still verify the chosen model's tool support.
- Plain chat without tools: `tool_use_failed` only fires on tool turns, so a
  chat-only integration won't hit it (but `.chat()` is still required for Groq).

```js
search_lessons({ query: "groq vercel ai sdk tool_use_failed tool calling chat endpoint", platforms: ["groq"] })
```

- [[lsn_ai_sdk_tool_execute_no_throw]] — the complement inside the loop: a tool's
  own `execute` must never throw either, or the same turn ends with no text.
