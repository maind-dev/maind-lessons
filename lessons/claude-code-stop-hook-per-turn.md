---
id: lsn_claude_code_stop_hook_per_turn
title: "Diagnose a hook predicate that is only right on turn 1 — Claude Code's Stop fires per TURN, not per session"
type: debugging_lesson
tier: community
context:
  tools: [claude-code]
  languages: [typescript]
  platforms: []
  tags: [hooks, agent-state, silent-failure, session-lifecycle, telemetry]
summary: >-
  Claude Code runs the Stop hook at the end of every assistant turn, not once when the
  conversation ends. A hook that "closes the session" there runs many times per
  conversation, so anything it deletes or resets is gone from turn 2 on — a guard
  reading that state then produces false negatives that look like a broken predicate,
  and a duplicate-suppression tombstone swallows every later delta. Store
  conversation-scoped facts outside the per-turn record.
last_validated_at: "2026-08-17"
---

## The mechanism

Claude Code fires `Stop` when the assistant finishes responding — once per **turn**,
not once per conversation. Ask three questions in one conversation and the Stop hook
runs three times. The name suggests finality; the lifecycle is a heartbeat.

`SessionStart` genuinely fires once (per start/resume/compact), so the asymmetry is
easy to miss: the opening hook matches its name, the closing one does not. Everything
below follows from that single fact.

**The diagnostic tell is temporal:** the first turn behaves correctly and every later
turn does not. If a predicate is right once and then stops being right, suspect a
per-turn reset before you suspect the predicate.

## Failure 1 — a guard that forgets what it just learned

A PreToolUse guard blocked edits until the session had consulted a knowledge source.
The consultation counter lived on the per-session record that the Stop hook closed
out and deleted.

- Turn 1: the model consults, counter goes to 1, guard would allow.
- End of turn 1: Stop fires, the record is closed and deleted.
- Turn 2: another hook re-creates the record with zeroed counters.
- Turn 2 edit: guard reads 0 → **warns despite the consultation having happened.**

In warn mode this is a nuisance. In a blocking mode it is a false denial — and a guard
that denies a condition the user demonstrably satisfied is the fastest way to teach
people to switch it off.

## Failure 2 — "duplicate suppression" that suppresses the real thing

The same misreading produces a subtler bug in the opposite direction. If you believe
Stop means session-end, a second Stop for the same session id looks like a duplicate,
and a tombstone to suppress re-processing feels obviously right:

```ts
// WRONG under the per-turn model
if (recentlyClosed(sessionId)) return;   // "we already closed this session"
queueMetrics(sessionId, delta);
```

Under the real model every turn after the first is "recently closed", so the guard
drops every delta but the first — silently, and with a comment explaining why it is
correct. Verification is direct: run a multi-turn conversation and inspect the queue.
Ours was empty while the tombstone map listed live sessions.

Those queued metrics are **per-turn deltas** by design; the sum over a session id is
the session total. A re-close is the next delta, not a duplicate.

## The rule: storage scope follows semantic lifetime

Ask what the fact is *about*, then pick the record whose lifetime matches:

| The fact is about | Lifetime | Where it belongs |
|---|---|---|
| this turn (tool calls, tokens since last Stop) | one turn | the per-turn record the Stop hook closes |
| this conversation (was it briefed? did a review run?) | whole conversation | a top-level map keyed by session id, or a separate per-session file |
| this machine / user | indefinite | config |

```ts
// state.json
{
  "sessions": { "<id>": { /* per-turn deltas; deleted at every Stop */ } },
  "conversation_signals": {                    // survives every Stop
    "<id>": { "consulted_at": "…", "reviewed_at": "…" }
  }
}
```

Give the durable map a TTL sweep (a week is generous) and prune it where you close a
turn — otherwise you trade a forgetful map for an immortal one. Two neighbours of the
same fact: because `SessionStart` opens a record that only `Stop` closes, a host that
dies mid-turn leaves an **orphan record** forever (sweep it with the same TTL — we
found two three weeks old); and a Stop hook that *blocks* the stop (to demand a review,
say) lets the conversation continue and stop again, so a completion gate and per-turn
bookkeeping on the same event interact. Make the bookkeeping idempotent per turn
rather than trying to detect "the real end" — there is no such event to detect.

## Verification

You cannot see this in a single-turn test — which is exactly why it survives review.
Use a conversation with at least three turns:

```bash
# after turn 1, then again after turn 3
jq '{sessions: (.sessions|keys), queued: (.pending_metrics|length),
     signals: (.conversation_signals // {} | keys)}' ~/.<your-tool>/state.json
```

- `sessions` empties after every turn and refills on the next — expected.
- `queued` grows once per turn; if it stops growing after turn 1, a tombstone or dedup
  guard is eating deltas.
- `signals` keeps its keys across all turns; if a key disappears, it is still parked on
  the per-turn record.

## When this does not apply

- **Single-turn / headless runs** (one prompt, one answer, exit). Turn and session
  coincide, so the distinction is invisible — and a test suite built only from such
  runs will never reproduce this.
- **Genuinely per-turn facts.** Token deltas, tool-call counts and duration *should*
  reset; that is the design, not a bug.
- **Other agent runtimes.** Verified for Claude Code hooks. Other harnesses may fire a
  true session-end event — check before porting the layout. The transferable part is
  the rule, not the event name.

Retrieve this from a session that is debugging a misfiring hook:

```
search_lessons({ query: "hook state resets every turn guard false negative",
                 tools: ["claude-code"], tier: "all" })
get_lesson({ id: "lsn_cross_session_guard_discipline" })   // the fail-open half
```

Cross-refs: [[lsn_cross_session_guard_discipline]] (fail-open discipline such guards
need — this entry is the state-lifetime half of building one that does not misfire) ·
[[lsn_settings_local_hook_path_migration]] (the other quiet way hooks stop doing what
you think they do).
