---
id: lsn_next_server_action_form_must_not_throw
title: "Fix a full-page crash: a Next.js Server Action used as a form `action` must not throw — use useActionState"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: []
  languages: ["typescript"]
  platforms: ["nextjs"]
  tags: ["nextjs", "app-router", "server-actions", "react-19", "error-handling", "forms"]
summary: "A Server Action wired directly to `<form action={fn}>` that throws on a failed save (validation/RPC error) has no place to surface the error — without an error.tsx boundary the throw escalates to the App Router root error page (a full-page crash). Use a non-throwing action returning a result object + useActionState to render the error inline."
last_validated_at: "2026-06-10"
---

## Symptom

Submitting a dashboard form succeeds on valid input but, on an invalid one (e.g. a field over its length limit, or an RPC error), the whole page goes to a blank/error screen ("page no longer reachable") instead of showing a field error. Nothing is persisted. The happy path looks fine, so the bug hides until someone submits bad input.

## Root cause

A Server Action used as a form's `action` runs server-side; if it `throw`s, React/Next has nowhere to put the error in the form lifecycle. In the App Router an uncaught error in an action bubbles to the nearest `error.tsx`. If the route group has no `error.tsx`, it escalates to the root error page — the entire segment unmounts. A common trigger is a thin "direct" wrapper that converts a non-throwing action into a throwing one:

```ts
// ANTI-PATTERN: throwing wrapper used as <form action={...}>
export async function saveDirect(formData: FormData): Promise<void> {
  const result = await save(null, formData); // save() returns {ok:false,error}
  if (!result.ok) throw new Error(result.error); // <-- escalates to root error page
}
```

## Fix

Keep the action non-throwing (return a discriminated result) and drive the form with `useActionState`, rendering the error inline:

```tsx
"use client";
import { useActionState } from "react";
import { saveAction } from "./actions"; // (prev, formData) => Promise<{ok:true}|{ok:false,error}>

export function EditForm() {
  const [state, formAction, pending] = useActionState(saveAction, null);
  return (
    <form action={formAction}>
      {state && state.ok === false ? <p role="alert">{state.error}</p> : null}
      {/* inputs */}
      <button disabled={pending}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}
```

Add `error.tsx` per route group as defense-in-depth so ANY future throw (a second action, a render error) degrades to a friendly reset UI instead of the root crash.

## Gotchas

- A `*Direct`/`*FormAction` wrapper that `throw`s defeats an otherwise correctly non-throwing action. Wire the form to the non-throwing action itself.
- Each row in a list that renders its own `<form>` needs its OWN `useActionState` hook (in the row component), not one shared at the list level.
- Mirror server-side validation limits as client `maxLength` so an over-long paste is blocked at input time, not only rejected server-side.
- The action signature for `useActionState` is `(prevState, formData) => Promise<State>` — the same shape works directly; no wrapper needed.

## When this does NOT apply

Server Actions invoked imperatively from an event handler (`await saveAction()` inside `onClick`) can legitimately `throw` and be caught in a local `try/catch`. The no-throw rule is specifically for actions passed as a form's `action` (or `formAction`) prop, where there is no caller to catch.

## Related

- A different App-Router full-page-crash class from a server/build boundary: [[lsn_next_dynamic_ssr_false_client_only]].
- Surfacing structured errors instead of generic failures: [[lsn_supabase_functions_invoke_error_body]].
- To retrieve this before wiring a form action: `search_lessons({ query: "server action form action throws crash", platforms: ["nextjs"] })`.
