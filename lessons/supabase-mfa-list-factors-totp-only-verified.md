---
id: lsn_supabase_mfa_list_factors_totp_only_verified
title: "Diagnose Supabase MFA 422 friendly-name conflict — listFactors().totp hides unverified pendings"
class: lesson
type: debugging_lesson
tier: community
context:
  tools: []
  languages:
    - typescript
  platforms:
    - supabase
  tags:
    - supabase
    - auth
    - mfa
    - totp
    - enrollment
    - silent-failure
last_validated_at: "2026-05-29"
summary: |
  supabase.auth.mfa.listFactors() returns data.totp filtered to verified factors only — unverified pendings live in data.all. Stale-cleanup on .totp silently finds nothing, next enroll fails with 422 conflict.
---

When a user starts a TOTP enrollment in supabase-js (`supabase.auth.mfa.enroll({ factorType: "totp", ... })`) and cancels before verifying the 6-digit code, the factor row stays in `auth.mfa_factors` with `status = 'unverified'`. The application is responsible for cleaning these up before the next enroll attempt — otherwise the user hits a 422 conflict on the deterministic `friendlyName`:

> `A factor with the friendly name "maind · 2026-05-29" for this user already exists`

The trap: `supabase.auth.mfa.listFactors()` returns a structured response where `data.totp` and `data.phone` are **pre-filtered to verified factors only**, while `data.all` contains everything (verified + unverified, all factor types). The naive cleanup loop that iterates `data.totp` to find stale factors silently finds **none** — even though there's a pending unverified TOTP row sitting in `auth.mfa_factors` that will collide.

## Why the API is shaped this way

The supabase-js source (`GoTrueMFAApi.listFactors`) explicitly filters `data.totp` to `status === 'verified'`:

```ts
// from gotrue-js GoTrueMFAApi.listFactors:
const totp = factors.filter(
  (factor) => factor.factor_type === 'totp' && factor.status === 'verified'
);
const phone = factors.filter(
  (factor) => factor.factor_type === 'phone' && factor.status === 'verified'
);
return {
  data: {
    all: factors,
    totp,
    phone,
  },
  error: null,
};
```

The reasoning: most consumers of `listFactors()` want to ask "is MFA active?" — for which an unverified factor is irrelevant. The verified-only convenience field is the more common case. But this makes the convenience field useless for stale-cleanup, which is the *less* common case but the one with silent failure.

## The fix

Filter `data.all` with both predicates explicitly:

```ts
const { data: factorList, error: listError } = await supabase.auth.mfa.listFactors();
if (listError) {
  return { status: "error", message: listError.message };
}

// Verified-check uses .totp (efficient, that's what the field is for)
const verifiedTotp = (factorList?.totp ?? []).find((f) => f.status === "verified");
if (verifiedTotp) {
  return { status: "error", message: "Authenticator app is already enabled." };
}

// Stale-cleanup MUST use .all — .totp doesn't contain unverified factors
const stale = (factorList?.all ?? []).filter(
  (f) => f.factor_type === "totp" && f.status !== "verified",
);
for (const s of stale) {
  await supabase.auth.mfa.unenroll({ factorId: s.id });
}

// Now safe to enroll
const { data, error } = await supabase.auth.mfa.enroll({
  factorType: "totp",
  friendlyName: `maind · ${new Date().toISOString().slice(0, 10)}`,
  issuer: "maind",
});
```

## How the bug surfaces

The collision is not deterministic in dev — first enroll succeeds (no pending factors). Only the second-or-later enroll after a cancel hits it. Easy to miss in QA if the test plan only covers happy paths.

The symptom in a UI built on Supabase MFA:

1. User opens TOTP enrollment modal
2. QR code appears
3. User closes / cancels before entering verify code
4. User re-opens TOTP enrollment
5. **422 error**: "A factor with the friendly name X already exists"
6. User is now stuck — they cannot re-enroll without admin intervention

## Detection across the codebase

```bash
# Find listFactors usage:
rg "supabase\.auth\.mfa\.listFactors" --type ts

# For each hit, check what's done with .totp:
# - If just checking "has MFA?" via .find(verified) — OK
# - If filtering for cleanup via .filter(status !== 'verified') — BUG
```

Linter rule for projects with custom rule support: any `.filter` on `listFactors().*.totp` that compares status against unverified should be flagged.

## Anti-patterns

- Hardcoding a unique `friendlyName` (e.g. UUID per session) to "avoid the collision". This kicks the can — `auth.mfa_factors` accumulates unverified pendings forever, eventually hitting per-user factor-count limits.
- Falling back to `supabase.auth.admin.deleteFactor` from a service-role context to clean up. Service-role from a user-facing flow is unnecessary privilege escalation — the user can clean up their own factors via `mfa.unenroll`.
- Catching the 422 and silently retrying. Hides the diagnostic; users still see the error if the retry races.

## When this does not apply

If your enrollment flow verifies atomically (no cancel-before-verify window) or you never reuse a deterministic `friendlyName`, the collision can't occur. The lesson is specific to flows where (a) the friendly-name is deterministic per user/day and (b) the user can abandon a started enrollment.

## Why this is worth knowing

The convenience-field shape (`data.totp` excluding unverified) is not documented in the obvious places (`supabase-js` README, MFA quickstart). Discovering it requires either reading the source or having the cleanup-cycle bite you in production. The silent-failure characteristic ("loop finds nothing, then the enroll fails") is the worst combination for debugging.