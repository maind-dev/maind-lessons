---
id: lsn_dismiss_persistence_hierarchy_session_db_behavioral
title: "Match optional-prompt dismiss persistence to user intent — three storage scopes (session/permanent/behavioral)"
type: workflow_best_practice
tier: community
summary: "Optional UI prompts (modals, banners, wizards) need a dismiss-marker whose storage scope matches semantic intent. 'Decide later' = session-cookie; 'never again' = persistent DB; 'user is already engaged' = behavioral signal (e.g. has-API-key). Logout must clear session markers. Implicit behavioral off-switches beat explicit dismiss buttons."
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  languages: []
  platforms: []
  tags:
    - ux
    - session-cookies
    - behavioral-state
    - onboarding
    - dismiss-marker
    - persistence
    - logout
---

## The hierarchy

Three storage scopes for "should this prompt show again?" — pick by user intent, not by what's easiest to implement:

| Scope | User intent | Storage | Survives... |
|---|---|---|---|
| **Session** | "Not now, ask me later" | HttpOnly browser-session cookie (no maxAge) | Tab close: yes. Browser close: no. Logout: no (must be cleared). |
| **Permanent** | "I've decided, never ask again" | DB row keyed by user_id | All sessions. Cleared only by explicit user action (e.g. settings reset). |
| **Behavioral** | (implicit) "User is engaged, prompt is redundant" | Derived from existing data (has-API-key, has-N-events) | Tracks reality automatically; needs no explicit dismiss action. |

The first two are explicit user actions; the third is a derived signal. Most "should I show this prompt?" decisions need at least the third — sometimes all three.

## How the scopes compose

A robust trigger combines them as OR-of-suppressors:

```ts
// Server-side (e.g. Next.js Server Component reading cookies + DB)
const sessionDismissed = (await cookies()).get("prompt_skipped")?.value === "1";
const permanentDismissed = userPrefs.never_show_again === true;
const userIsEngaged = activeApiKeyCount > 0; // behavioral signal

const showPrompt = !sessionDismissed && !permanentDismissed && !userIsEngaged;
```

Each suppressor encodes a different semantic. Removing any one weakens the UX:

- Without **session-dismiss**: every page-load re-shows the prompt within the same browser session → annoying.
- Without **permanent-dismiss**: user can never declare "this isn't for me" → indefinite re-prompting.
- Without **behavioral**: user who's actively using the system keeps seeing onboarding hints → noise.

### The "decide later" mistake

The most common bug class: implementing "Skip for now" as a permanent DB marker.

```ts
// WRONG — sets permanent state on a temporary action
async function dismissPrompt() {
  await db.update(users).set({ prompt_dismissed_at: new Date() })
    .where(eq(users.id, callerId));
}
```

User clicks "Skip for now" → permanent DB row → prompt never appears again, even after logout / browser-restart / weeks. Defeats the entire point of an optional prompt: it's no longer *optional* with a re-prompt fallback.

The fix is to match storage to intent. "Skip for now" should set a session-scoped marker:

```ts
// RIGHT — session-only cookie, no DB write
async function dismissPrompt() {
  const cookieStore = await cookies();
  cookieStore.set("prompt_skipped", "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // NO maxAge → browser-session cookie, dies when browser closes
  });
}
```

A separate "Never show this again" button (or settings toggle) writes the permanent DB marker. Two buttons, two scopes, mapping cleanly to two user intents.

### Logout must clear session cookies

Browser-session cookies survive logout. If you set a session-skip cookie and the user logs out + logs back in (same browser session, different account or same account), the cookie carries the old dismiss state into the new session. That's almost never the intent.

```ts
// In your logout action
export async function logout() {
  await auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete("prompt_skipped");
  cookieStore.delete("other_session_markers");
  redirect("/login");
}
```

This is its own discipline: every time you add a session-scoped UI marker, audit the central logout path. Skip-cookies that aren't logout-cleared are the analogue of permanent DB markers that aren't user-resettable — both leak state across what users perceive as boundaries.

## Behavioral signals beat explicit dismiss

Counterintuitive but reliable: if you can derive "user no longer needs this prompt" from their actual behavior, you don't need them to click Dismiss. Examples:

- **Onboarding wizard**: suppress when user has ≥1 active API key. They're "in the system" — the wizard's purpose is fulfilled.
- **Upgrade banner**: suppress when user is on a paid plan.
- **Tutorial overlay**: suppress when user has performed the action the tutorial demonstrates ≥N times.

The advantage: zero UX friction, no permanent-dismiss-marker-needed, automatically adapts when the user's relationship to the feature changes. The disadvantage: requires a query against real data — slightly more expensive than reading a single DB column or cookie.

For trigger decisions that happen on hot paths (page render), keep the behavioral query cheap (an indexed `COUNT(*)` with a `LIMIT 1` is fine; a full aggregation is not).

## When NOT to use this

- **One-shot prompts that genuinely must be answered once**: cookie banners, terms-of-service acceptance, legal disclosures. These are permanent-DB-marker territory by design — "ask me later" doesn't apply.
- **System-critical prompts**: payment-failed notifications, account-suspended warnings. Suppress on neither cookie nor behavioral signal — they must be visible until resolved.
- **First-load only prompts** with no re-prompt requirement: a single-line tip on first page-load that you never want to show again is simpler as a single permanent flag. The hierarchy is overhead.

When in doubt: ask "would the user be annoyed if this prompt came back tomorrow?" — yes → permanent. "would the user be annoyed if this prompt came back in this same session?" — yes → session. Both no → behavioral signal is probably enough.

## Anti-patterns

- **Single DB column for all dismiss scopes.** Loses the session/permanent distinction. Either user is annoyed (dismiss-now-means-forever) or you lose audit (revert-on-every-login).
- **localStorage for session-dismiss**: works in the browser, invisible to Server Components. Cookies are the only browser-state primitive that crosses both layers cleanly.
- **Behavioral signal that requires consent-gated data.** If your behavioral query reads from telemetry that's behind a consent toggle (e.g. only-with-tier-1-events), users who disabled consent will see the prompt forever. Use unconditional data (API-key count, account-age, plan-tier).
- **Forgetting to clear session-cookies on account-delete.** Same class as logout-cleanup; if the user deletes their account and their email is later reused (different person, same address), the cookie carries the old dismiss state.

## Related vetted conventions

- [[lsn_supabase_logout_inflight_401_flood]] — another logout-edge-case class: state that should reset on logout but doesn't, by default. Same audit discipline applies.
- [[lsn_jsonb_concurrent_sync_lost_update]] — when the permanent-DB-marker layer is implemented via JSONB preferences, atomic-update patterns matter (lost-update protection).

To find this convention from a debugging context:

```ts
await search_lessons({
  query: "dismiss persistence session cookie permanent optional prompt",
});
// Expect lsn_dismiss_persistence_hierarchy_session_db_behavioral in results.
```
