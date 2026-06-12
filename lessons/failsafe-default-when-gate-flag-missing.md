---
id: lsn_failsafe_default_when_gate_flag_missing
title: "Migrating a binary gate to per-flag entitlements: fail toward prior behaviour when a flag is missing or malformed"
type: workflow_best_practice
tier: community
summary: "Replacing a binary gate (e.g. isPaid) with fine-grained DB-driven feature flags leaves a window where callers see NO flag: a stale auth cache, a server deployed before the seed, or a malformed JSONB value. If 'flag missing' means 'allowed', you open a transient hole. Fail toward the OLD behaviour instead: use the flag only when present-and-boolean, else fall back to the prior coarse rule. Seed the flags behaviour-preserving so nothing changes until an admin flips them."
gotchas:
  - "The dangerous default is 'absent means grant'. Choose 'absent means prior behaviour' so a not-yet-propagated flag never widens access."
  - "Guard the type too: a JSONB \"true\" string or a 1 is NOT a boolean — `typeof v === 'boolean' ? v : fallback` stops bad tooling from silently granting."
  - "Seed the new flags so they reproduce today's gate (e.g. free=off / paid=on) BEFORE the reader ships — the migration is then a no-op for live users."
  - "Caches make this real, not theoretical: a 60s auth cache means some requests run with the old (flagless) context right after deploy."
context:
  languages: [typescript, sql]
  platforms: [postgres, supabase]
  tags: [access-control, feature-flags, entitlements, fail-safe, caching]
---

## The window you have to cover

Moving from `const allowed = plan !== 'free'` to `const allowed = features.curated_lessons === true` looks like a clean swap. But between deploy and full propagation there is a window where `features` is absent or stale:

- the auth/identity cache still holds a pre-migration context,
- a server instance shipped before the flag was seeded,
- the JSONB has a malformed value (a `"true"` string from admin tooling).

## The rule: fail toward the prior behaviour

```ts
function entitled(ctx, key) {
  const v = ctx.features?.[key];
  if (typeof v === 'boolean') return v;   // authoritative
  return ctx.plan !== 'free';             // prior coarse gate
}
```

Two properties matter:

1. **Direction.** The fallback reproduces the OLD gate, so a not-yet-present flag never grants MORE than before. (For sensitive features, be willing to fail toward *less* access.)
2. **Type-safety.** A non-boolean value is treated as "absent", so malformed data cannot accidentally satisfy `=== true` or be coerced.

## Seed behaviour-preserving

Ship the seed migration that sets every new flag to reproduce today's outcome (e.g. free plans off, paid plans on) with an idempotent guard. Then the reader change is a no-op for existing users, and the only thing that ever changes visibility is an explicit admin edit.

## When this does not apply

For a brand-new restrictive feature, `absent means deny` is correct — there is no prior access to preserve. The fail-toward-prior rule is specifically for MIGRATING an existing gate, where hard-deny-on-missing would briefly revoke access paid users already have during the propagation window.

## Related

- [[lsn_defense_in_depth_rls_eq_filter]] — belt-and-suspenders access control: layer an explicit check even when a higher layer already enforces.
- Companion `lsn_postgres_create_or_replace_validation_drift`: when the gate lives in a SQL function, the same fail-safe direction protects against a silently dropped check.
