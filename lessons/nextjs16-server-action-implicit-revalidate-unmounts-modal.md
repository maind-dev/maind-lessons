---
id: lsn_nextjs16_server_action_implicit_revalidate_unmounts_modal
title: "Modal disappears after Server Action — Next.js 16 implicit revalidation fires defensive redirect"
class: lesson
type: debugging_lesson
tier: curated
context:
  tools: []
  languages:
    - typescript
  platforms:
    - nextjs
  tags:
    - nextjs
    - app-router
    - server-actions
    - revalidation
    - client-state
    - silent-failure
last_validated_at: "2026-05-29"
summary: |
  Next.js 16 implicitly revalidates the active route after Server Actions. Defensive Server-Component redirects based on the just-mutated state fire post-action and unmount any open client modal.
---

In Next.js 16 App Router, calling a Server Action (whether via `<form action={...}>` or as a directly-invoked async function from a Client Component) triggers automatic revalidation of the currently-rendered route — regardless of whether the action calls `revalidatePath` explicitly. This is intentional for "form submits → fresh data" patterns but breaks defensive Server-Component-Redirect guards that key off the same data the action just mutated.

The bug surfaces when all four conditions hold:

1. A Server Component page has a defensive redirect like `if (ctx.has_factor) redirect("/somewhere-else")`
2. The same page renders a Client Component that calls a Server Action
3. The Server Action mutates the DB so that the redirect-condition flips to true
4. The Client Component has visual state (modal, animation) that should outlive the action

After the action returns, Next.js re-runs the Server Component → it now sees `has_factor=true` → `redirect()` fires → the entire client tree unmounts → the modal disappears mid-animation.

## A concrete repro

```tsx
// page.tsx — Server Component
export default async function MfaRequiredPage() {
  const ctx = await getUserMfaContext();
  if (!ctx.mfa_required) redirect("/");
  if (ctx.has_totp || ctx.has_passkey) redirect("/settings/security");
  //  ^^ THIS is the trap

  return <ForceEnrollClient user={...} />;
}

// ForceEnrollClient.tsx — "use client"
function ForceEnrollClient({ user }) {
  const [state, dispatch] = useReducer(modalReducer, INITIAL);
  return (
    <Dialog open={true}>
      <PasskeyInlineFlow
        onSuccess={async () => {
          // 1. Server Action runs
          await finishPasskeyRegistration(attestation, name);
          // 2. Next.js auto-revalidates page.tsx
          // 3. page.tsx sees has_passkey=true → redirect("/settings/security")
          // 4. Modal tree unmounts before dispatch ever runs
          dispatch({ type: "PASSKEY_SUCCESS" });
        }}
      />
    </Dialog>
  );
}
```

The user sees the WebAuthn browser-prompt complete successfully, then briefly the success-flash, then suddenly they're on `/settings/security` — confused, because they were just told "Account Secured".

## Why "defensive" redirects feel correct but bite

The redirect-on-mismatch pattern (`if (state-X-is-now-true) redirect`) is genuinely defensive against direct-URL access — a user navigating to `/auth/mfa-required` with `has_passkey=true` shouldn't see the enrollment page. In a pre-React-18 / pre-Server-Actions world, this was a one-shot navigation guard that ran exactly once per page-load.

Next.js 16 changes that model: the Server Component re-runs after every Server Action. The "guard" now fires not just on direct nav but on every successful in-page mutation. If the action's whole purpose is to flip the guard-state, the guard fires immediately after success.

## The fix: remove the post-action redirect

In any Server Component that hosts a Client Component which calls a Server Action that mutates the redirect-condition, **delete the defensive redirect**. The Client Component is the authoritative driver post-action; it knows what UI state should follow and when to navigate.

```tsx
// page.tsx after fix — Server Component
export default async function MfaRequiredPage() {
  const ctx = await getUserMfaContext();
  if (!ctx.mfa_required) redirect("/");
  // REMOVED: if (ctx.has_totp || ctx.has_passkey) redirect("/settings/security");
  // The Client Modal handles post-enroll navigation via router.replace() on
  // explicit user action ("Continue to dashboard" button), NOT via Server-
  // Component-driven redirect.

  return <ForceEnrollClient user={...} />;
}
```

The Client Component then explicitly drives navigation when the user clicks through:

```tsx
function ForceEnrollClient({ user }) {
  const router = useRouter();
  return (
    <SecureAccountModal
      onSecured={() => router.replace("/")}  // <-- explicit, user-triggered
    />
  );
}
```

## Differentiating from other "modal disappears" causes

| Symptom | Likely cause |
|---|---|
| Modal disappears immediately on Server Action call | Server-Component-redirect after auto-revalidate (this convention) |
| Modal disappears after a programmatic `router.push/replace` | Intentional navigation, check call sites |
| Modal disappears after `revalidatePath` of the modal's own route | Explicit revalidation, remove or scope it |
| Modal disappears on subsequent navigation but not immediately | Component-unmount due to route change elsewhere, separate bug |

The smoking gun for this specific class is "modal disappeared right when the Server Action completed, and the URL changed too". URL-change without explicit `router.*` call → server-driven redirect → check page.tsx guards.

## When this does not apply

If the Server Component has no state-dependent redirect (only a static auth-gate that the action doesn't flip), or if the post-action UI is itself a fresh server render (no client modal to preserve), there's nothing to unmount. The trap is specific to "action flips the very condition a defensive redirect guards" + "client visual state must survive the action".

## Why this is worth knowing

The Next.js 16 implicit-revalidation behavior is a subtle shift from earlier App Router versions where revalidation was explicit. Existing defensive-redirect patterns from Next 14 codebases get carried forward and start silently misfiring after upgrading. The symptom (modal animation cut short) looks like a CSS/timing bug, leading developers down the wrong debugging path — increasing animation duration, adding `setTimeout` delays — none of which address the root cause.