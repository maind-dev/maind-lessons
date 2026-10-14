---
id: lsn_llm_retry_after_outlasts_route_timeout
title: "Diagnose silent empty replies from a tool-calling LLM route — the SDK waits out a 429 retry-after past your own timeout"
type: debugging_lesson
tier: community
summary: "A multi-step tool-calling route returns no text and no error, and nothing is logged. The provider's per-minute quota answers 429 with retry-after ~30 s, the AI SDK waits that out without knowing the route deadline, the route's AbortSignal fires first — and an abort is an `abort` stream part, not an `error`. Fix: retry in a deadline-aware fetch, maxRetries: 0 on the SDK, handle the abort part."
context:
  tools: [vercel-ai-sdk]
  languages: [typescript]
  platforms: [vercel, groq, nextjs]
  tags: [llm, tool-calling, rate-limit, retry-after, timeout, silent-failure, ai-sdk]
---

## Symptom

A chat or assistant route that runs several tool-calling steps per turn (`streamText` with `stopWhen: stepCountIs(n)`) sometimes ends with no text, no tool result and no error. The client shows its generic "couldn't answer" message. The server log is empty. It happens more on turns that need lookups first, and more when requests come in quick succession. Single-step questions work.

## Cause

Four facts combine:

1. **Every step resends the whole prompt.** System prompt plus all tool schemas plus history go to the provider again on each tool-call step. 4–5k input tokens per step is common; a lookup-then-propose turn takes 3–4 steps.
2. **Low-tier quotas are per minute and shared.** A provider tier with 8,000 tokens/minute for the whole account is exhausted by one such turn, or by two users at once. The provider answers `429` with `retry-after` of ~30 s.
3. **The SDK honours retry-after without knowing your deadline.** The AI SDK's retry respects `retry-after`/`retry-after-ms` up to 60 s, with `maxRetries: 2` by default. Two waits of 30 s outlast a route budget of 55 s.
4. **An abort is not an error.** When the route's `AbortSignal.timeout(...)` fires, `fullStream` yields a part of type `abort`. Code that only checks `part.type === "error"` sees nothing: no fallback runs, no log line is written, and the turn ends empty.

## Confirm

Replay the turn outside the route with the same model, prompt and tools, and log every stream part plus per-step usage:

```ts
for await (const p of result.fullStream) {
  if (p.type === "finish-step") console.log("step", p.finishReason, p.usage?.inputTokens);
  else if (p.type === "error") console.log("ERROR", (p.error as Error)?.name);
  else if (p.type === "abort") console.log("ABORT");
}
```

Run the same request three times in a row. Seeing it succeed once and then `ABORT` after a step, with ~4–5k input tokens per step, confirms the quota path. The provider's 429 body names the per-minute limit.

## Fix

Retry in one layer that knows the deadline, and make every terminal state visible:

```ts
const deadlineMs = Date.now() + 52_000; // under the route's maxDuration
const model = createOpenAI({ apiKey, baseURL, fetch: deadlineFetch({ deadlineMs }) }).chat(id);

const result = streamText({
  model, system, messages, tools,
  maxRetries: 0, // the fetch retries; otherwise two layers wait in sequence
  abortSignal: AbortSignal.timeout(deadlineMs - Date.now()),
});

for await (const part of result.fullStream) {
  if (part.type === "error") failure = classify(part.error); // 429 → "busy"
  else if (part.type === "abort") failure = "timeout";
}
if (!sentText && !hadToolOutput) {
  console.error("no answer", failure ?? "empty");
  send({ t: "error", code: failure });
}
```

`deadlineFetch` retries 408/409/429/5xx at most twice, waits `retry-after` (else a short backoff), and only when `now + wait + minCallMs <= deadline`. Otherwise it returns the 429 at once, so the user gets an honest "busy, try again in ~30 s" in seconds instead of a misleading empty reply after a minute.

Also:

- **Skip a no-tools fallback after a 429.** It runs into the same quota.
- **Cut tokens per step.** On a focused page, register only the tools that page needs and drop unrelated prompt sections. Measured: 3,840 instead of ~4,700 input tokens per step.
- **Treat a delivered tool result as an answer.** If the model produced a preview/side effect and then the final text step failed, show the result instead of an error.

## When this does NOT apply

- Single-step, no-tool routes: they rarely exceed the quota in one turn.
- Providers or tiers with generous limits: fix the abort handling anyway, the silent path still exists for any slow step.
- `tool_use_failed` from the provider is a different error: see [[lsn_groq_ai_sdk_tool_calling]].
- A tool's own `execute` throwing ends the turn too: see [[lsn_ai_sdk_tool_execute_no_throw]].

```js
search_lessons({ query: "tool calling route empty reply no error 429 retry-after abort timeout ai sdk", platforms: ["vercel"] })
```
