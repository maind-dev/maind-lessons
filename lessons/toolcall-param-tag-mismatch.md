---
id: lsn_toolcall_param_tag_mismatch
title: 'Diagnose a paired "Required" + "too-long" tool-call error as one truncated parameter block'
type: debugging_lesson
tier: community
context:
  tools: [claude-code, claude-desktop, cursor, windsurf]
  languages: []
  platforms: []
  tags: [mcp, tool-calls, agent-behavior, serialization, debugging, validation]
summary: When a tool call carries several array or multi-line parameters and the client serializes them as independently-closed delimited blocks (XML-style tags, fenced sections), one mismatched closing delimiter truncates the block — trailing params arrive `undefined` (a "Required" error) while the stray closing tokens are absorbed into the preceding value (an unexpected "too-long"/max-length error). The paired signature is a malformed-call symptom, not a schema problem.
problem: |
  A tool takes one short string (`focus`) plus three array params. The
  validator rejects the call with TWO errors at once — `focus`: "at most
  500 characters" (too_big) AND `recent_decisions`: "Required". The agent
  shortens `focus`, retries, gets the same error, concludes "the tool
  rejects arrays", and abandons it for manual work. The diagnosis is wrong:
  neither field was malformed by intent — the serialization dropped one
  param and inflated another.
solution: |
  Recognise the paired signature and fix the CALL, not the values: re-emit
  the whole tool call with every parameter block closed by exactly one
  matching delimiter. Details, mechanism, and boundaries in the body.
---

A `too_big`/max-length error on parameter A **together with** a `Required`
error on the parameter that came right after it, in the same tool call, is
almost never two independent mistakes. It is one truncated block.

## The fingerprint

```
focus           : String must contain at most 500 characters  (too_big)
recent_decisions: Required
```

You wrote a one-sentence `focus` and a full `recent_decisions` array, yet
both are flagged. That contradiction is the tell.

## Why the two errors come together

Many clients serialize a tool call as independently-closed blocks, e.g.
`<parameter name="x">…</parameter>` or fenced sections. The parser reads
until the first well-formed closing delimiter. If ONE param is closed with
the wrong delimiter:

1. The block truncates early → every param after it is never parsed →
   arrives `undefined` → **"Required"** on that later field.
2. The stray closing tokens that should have ended the block
   (`</parameter>`, `</invoke>`, a stray fence) get swallowed into the
   LAST successfully-parsed value → it is now far longer than you wrote →
   **"too-long"/max-length** on a field you kept short.

So `too_big` on A + `Required` on the next field B = fingerprint of a
truncated block, not two schema violations.

## The fix

- Do **not** shorten the over-long value or delete the "missing" field.
- Re-emit the WHOLE call with every parameter block closed by exactly one
  matching delimiter. Before sending a multi-array / multi-line call,
  visually scan that each closing tag is identical in shape.
- If the value that tripped max-length literally contains `</parameter>`,
  `</invoke>`, or a stray fence, that is the proof — strip it and the
  paired "Required" clears with it.

## When this does not apply

- A `too_big` ALONE on a field you genuinely overfilled is real — shorten.
- A `Required` ALONE on a field you genuinely forgot is real — add it.
- JSON-encoding clients fail differently (malformed calls are usually
  rejected wholesale before the schema runs); this signature is specific
  to clients serializing params as independently-closed delimited blocks.

## Anti-patterns

- **Trusting the error's surface meaning.** "too_big" reads as "my text is
  too long" — but if you didn't write long text, believe your intent.
- **Concluding the tool is broken.** "It rejects arrays" after two failed
  retries abandons a working tool over a formatting slip.
- **Retrying verbatim.** The same malformed serialization reproduces the
  same error — change the call's formatting, not its content.

## Related

- `lsn_anti_embellishment_clause` — the sibling agent-serialization-discipline
  failure (agents adding `**markdown**` to values that must stay literal).
- `lsn_surface_silent_errors_first` — when the failure is silent rather than
  a loud validation error.

To check for an updated version of this pattern:
`search_lessons({query: "tool call required too long truncated parameter", tools: ["claude-code"]})`.
