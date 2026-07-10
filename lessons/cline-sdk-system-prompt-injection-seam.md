---
id: lsn_cline_sdk_system_prompt_injection_seam
title: "Fix silent no-op system-prompt injection in the Cline SDK — register a rule extension, not `beforeModel`"
type: debugging_lesson
tier: community
summary: "Cline SDK (verified at cline@92806c60): the obvious beforeModel hook cannot change the system prompt — its result type has only messages/tools/options, so a returned systemPrompt is silently dropped. The supported in-process, file-free seam is a contribution extension calling api.registerRule({content}); rules are folded into config.systemPrompt, re-sent every iteration — immune to history compaction. prepareTurn threads systemPrompt but is host-internal (core fork only)."
context:
  tools: [cline]
  languages: [typescript]
  platforms: []
  tags: [cline, sdk, system-prompt, context-injection, hooks, agent-tooling]
---

## The trap

You want to inject always-on context (team conventions, policies) into every
model turn of a Cline-based agent — in-process, without writing a `.clinerules`
file to disk. The SDK exposes hook surfaces with slightly inconsistent
capabilities, and the one that *looks* right silently does nothing:

- **`beforeModel` (AgentRuntimeHooks)** fires before each model call, but its
  result type (`AgentBeforeModelResult`, `sdk/packages/shared/src/agent.ts`)
  has only `messages?/tools?/options?` — **no `systemPrompt`**. The runtime's
  apply-loop (`sdk/packages/agents/src/agent-runtime.ts`) reads only those
  fields. Returning a systemPrompt from here is a **silent no-op** — no error,
  no injection.
- **`prepareTurn`** IS the per-iteration systemPrompt seam (the orchestrator
  threads its returned `systemPrompt` back into the outgoing
  `AgentModelRequest`), but it is **host-internal**: not exposed on
  `CoreSessionConfig`, and already occupied by context compaction. Reaching it
  requires forking core.

## The supported seam — a contribution-extension rule (no fork)

Cline's own `cline-user-instructions` plugin
(`sdk/packages/core/src/extensions/config/user-instruction-plugin.ts`) shows
the intended pattern: register a rule whose `content` is resolved at prompt
composition time.

```ts
const myConventionsExtension = {
  name: "my-conventions",
  manifest: { capabilities: ["rules"] },
  async setup(api) {
    api.registerRule({
      id: "my:conventions",
      content: () => CONVENTIONS_TEXT, // in-memory; string or (async) function
    });
  },
};
// pass via CoreSessionConfig.extensions (VS Code host: the session factory)
```

`composeSystemPrompt()` (session-runtime-orchestrator) folds every registered
rule into `config.systemPrompt`. Because the system prompt is a **separate
field re-sent on every iteration** — never a message in history — the injected
content is structurally immune to history truncation/summarization. `content`
may be a function, so it can be recomputed (it resolves once per run, not per
iteration).

## Verification

Log the outgoing request's `systemPrompt` at the model-call site and assert
your marker is present on iteration N>1 **and** after a forced compaction.
Do not trust "the hook ran" — verify the field the model actually receives.

## When this does NOT apply

- **File-based rules are acceptable** — `.clinerules` / rules directories are
  the documented user-facing path; this guidance targets in-process, file-free
  injection (bundled products, dynamic content).
- **You need true per-iteration recomputation** (content changes mid-run) —
  that requires the `prepareTurn` seam, i.e. a small core fork.
- **Other Cline hosts / future versions** — verified against
  `cline/cline@92806c60` (SDK-monorepo layout); hook surfaces may converge
  later, re-verify the result types before relying on this.

## Related

- [[lsn_agent_self_report_over_llm_judge]] — verify injection mechanically
  (log the actual request field), not via the agent's self-description.

Surface this from a session with:

```js
search_lessons({ query: "cline system prompt injection beforeModel registerRule", tools: ["cline"] })
```
