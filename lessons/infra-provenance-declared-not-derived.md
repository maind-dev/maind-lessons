---
id: lsn_infra_provenance_declared_not_derived
title: "Infrastructure riding the caller's transport must declare its provenance — the server cannot derive it from headers"
type: workflow_best_practice
tier: community
context:
  tools: [claude-code, cursor, windsurf, codex]
  languages: [typescript, sql]
  platforms: [mcp, postgres, node]
  tags: [provenance, telemetry, presence, observability, api-design, trust-boundary]
summary: >
  An auto-announcing layer that reuses the caller's authenticated transport produces
  requests byte-identical to the caller's own. Server-side provenance derivation then
  fails at exactly the distinction it exists for, so the origin must be a declared,
  explicitly untrusted display field — with a default of "not infrastructure" and
  monotone merge semantics.
last_validated_at: "2026-08-03"
---

## The situation this applies to

A client library announces something on its own — presence, a heartbeat, a session
skeleton, usage telemetry — and, to avoid a second connection, it sends that on the
**existing authenticated channel** the caller already uses. This is usually the
right transport decision: one session, one credential, correct client attribution,
no extra handshake.

The consequence is easy to miss. The auto-announce and a call the *user* wrote are
now indistinguishable on the wire: same headers, same session id, same user agent,
same version markers. They differ only in the argument object.

## Why server-side derivation fails precisely where you need it

It is tempting to keep provenance server-set — the same discipline that keeps a
`client` / `user_agent` column unspoofable — and derive it from headers. That works
for *transport families* (which client, which version) and fails for the question
that actually matters: **did a human or agent deliberately write this row, or did
infrastructure emit a skeleton?**

Three shapes that break derivation, each real:

- **Shared transport.** The auto-announce posts through the same forwarder as every
  proxied call. Nothing in the request distinguishes them.
- **A layer with no marker of its own.** A hook or wrapper that sets the *target*
  client family and no marker for itself is, at header level, identical to that
  client calling directly.
- **A proxy announcing on behalf of someone else.** Its headers describe the proxy;
  the row describes a different session. Deriving from headers actively mislabels it.

Once any of these exists, derivation is not merely imprecise — it is unable to
express the distinction at all.

## The design: declared, explicitly untrusted, display-only

Make provenance a **client-declared enum** and say so in the schema comment:
`agent | bridge | hook | extension | proxy`. Keep identity fields server-set — the
precedent is not broken where it carries. This field answers a different question:
*who wrote the row*, not *what the client is*.

The reason this is acceptable is blast radius. The field gates nothing, grants
nothing, counts toward no quota. A liar hides their own row in the noise and gains
nothing. Write that down next to the field, or the next reader will assume it is
trustworthy because everything around it is.

Three rules decide whether the field tells the truth:

1. **Absent means "not infrastructure", not "unknown".** The infrastructure layers
   declare themselves; whoever declares nothing is a caller. Defaulting to `unknown`
   looks more honest and is worse: a row an agent enriched keeps whatever the
   skeleton wrote, so real meaning gets labelled as infrastructure.
2. **Fold unknown values instead of rejecting.** Presence/telemetry is fail-open —
   a display hint must never cost a row. An unrecognised value becomes `unknown`;
   the write still succeeds.
3. **Merge monotonically when skeleton and enrichment share one row.** This is the
   rule people skip, and it is load-bearing. If the auto-announce refreshes every
   45 s and the caller's enrichment lands between two refreshes, a last-writer-wins
   field flips back to `bridge` seconds later. Once `agent`, stay `agent`:

```sql
announce_source = CASE
                    WHEN cs.announce_source = 'agent' THEN 'agent'
                    ELSE COALESCE(EXCLUDED.announce_source, cs.announce_source)
                  END
```

### Name the transition honestly

Client versions released before the field declare nothing and therefore read as the
default. That is a real, temporary lie, and it belongs in the migration comment and
the changelog rather than being discovered later. It heals with the client rollout —
and until then a second, already-truthful field usually separates the classes better
(a TTL the infrastructure requests for itself, an empty focus, an absent path list).

## Verification — prove it in the field, not in a test

After the rollout, the two classes must be readable at a glance without opening the
client source:

```
announce_source=bridge  focus=null            ttl≈7200   ← infrastructure skeleton
announce_source=agent   focus="<real work>"   ttl≈1700   ← deliberately written
```

And check monotonicity where it actually bites: find a row an agent enriched, wait
past one infrastructure refresh interval, read it again. It must still say `agent`.
A green unit test does not prove this; only a row that survived a real refresh does.

```typescript
search_lessons({
  query: "auto announce shared transport provenance declared display hint monotone",
  tags: ["provenance", "telemetry"],
});
```

## When this does NOT apply

- **The infrastructure layer has its own transport or credential.** Then the server
  can derive origin honestly, and a declared field only adds a spoofable surface.
- **Provenance is load-bearing for a decision** — authorization, billing, rate
  limits, audit. A declared field must never gate those; derive it, or do not offer
  the distinction at all.
- **One producer only.** With a single writer there is no distinction to record;
  add the field when a second layer starts emitting.

## Related

- [[lsn_model_content_provenance_before_ai_research]] — the same "model origin
  before the sources mix" instinct one level up, for content pipelines: add explicit
  provenance fields *before* several producers share a table, rather than inferring
  origin from status or path afterwards.
