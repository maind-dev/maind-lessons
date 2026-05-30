---
id: lsn_rn_module_scope_constants_i18n_usememo
title: Fix stale i18n labels in React Native — module-scope arrays evaluate before `t()` is available; move them into `useMemo`
type: debugging_lesson
tier: community
lesson_class: architecture
quality_tier: hand-vetted
context:
  tools:
    - react-native
    - expo
  languages:
    - typescript
  platforms:
    - ios
    - android
  tags:
    - i18n
    - react-native
    - module-scope
    - usememo
summary: >-
  In React Native (and React), module-scope constants like
  `const TABS = [{ label: "Home" }, { label: "Settings" }]` evaluate at
  module-import time — before any React hook including `useI18n()`. If
  the label needs translation, the call to `t()` either crashes
  ("hooks called outside a component") or returns the key string. The
  fix is to declare the array inside the component with `useMemo(() =>
  [...], [t])`, not at module scope.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The symptom

After wiring an i18n library (`react-i18next`, `expo-localization`, or
similar) into a React Native app, some labels never translate. Common
shapes:

- A tab bar shows the English key (`"home.tab"`) instead of the
  translated label.
- The app crashes on the first render with "Hooks can only be called
  inside the body of a function component."
- The label is correct on first render, but stays in the initial
  language after the user changes the app language.

When you `grep` for the offending label, you find it in a module-scope
constant:

```typescript
// labels.ts — top of file, not inside any component
const TABS = [
  { id: "home", label: t("home.tab") },         // ← evaluated at import
  { id: "settings", label: t("settings.tab") },
];
```

## What's actually happening

`t()` is bound to a React hook (`useI18n()`, `useTranslation()`, etc.).
Hooks resolve a value from React's context — that context only exists
*during a component render*. Module-scope code runs at JavaScript
import time, well before React mounts anything.

Three things can happen:

1. **`t` is `undefined` at import.** Calling `t("home.tab")` throws
   immediately — Metro shows a red-screen error.
2. **`t` is a global stub.** Some libraries fall back to "return the
   key as-is." You see the literal key in the UI and might mistake
   it for a missing translation key in the catalog.
3. **`t` is bound to a default language.** The constant captures
   the value at import-time and never updates when the user switches
   language. Other parts of the UI re-render correctly; this constant
   shows stale labels.

Same root cause for all three: module-scope code can't reach React
context.

## The fix

Move the array into the component and memoise on the `t` reference
(or the language tag):

```typescript
// MyScreen.tsx
import { useI18n } from "@/hooks/useI18n";
import { useMemo } from "react";

export function MyScreen() {
  const { t } = useI18n();

  const tabs = useMemo(
    () => [
      { id: "home", label: t("home.tab") },
      { id: "settings", label: t("settings.tab") },
    ],
    [t],
  );

  return <TabBar items={tabs} />;
}
```

`useMemo` re-runs the array literal when `t` changes — which happens
on language switch, since hooks return fresh references when their
underlying state changes. Now the UI updates correctly on
language change.

For arrays shared between several components, put the `useMemo` call
in a custom hook:

```typescript
export function useTabs() {
  const { t } = useI18n();
  return useMemo(
    () => [
      { id: "home", label: t("home.tab") },
      { id: "settings", label: t("settings.tab") },
    ],
    [t],
  );
}
```

Then `const tabs = useTabs()` at each call site. Same compile-time
i18n binding, no module-scope leak.

## What about module-scope helpers?

If a non-React utility needs to render translated strings
(`formatRelativeTime`, `getStatusLabel`), don't try to call `t()` from
inside — pass it in as a parameter:

```typescript
// time-utils.ts (module scope, no React)
export function formatRelativeTime(date: Date, t: TranslateFn): string {
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return t("time.just-now");
  return t("time.ago", { time: formatDuration(diff) });
}

// MyComponent.tsx (inside a component)
const { t } = useI18n();
const label = formatRelativeTime(updatedAt, t);
```

The helper stays pure; the caller is responsible for sourcing `t` from
the right scope.

## When this does not apply

- **Module-scope constants that aren't user-facing.** Internal lookup
  keys, sentinel values, debug labels — those don't need translation
  and stay at module scope.
- **Server-rendered translations (Next.js App Router, Remix).** The
  `t()` function on the server is a plain import, not a hook. Module-
  scope use is fine there.
- **Static labels that you've decided never to translate** (e.g.,
  brand names, "OK", numeric units). Stay at module scope; tag with
  a comment so the next refactor knows.

## Verification

```bash
# Find suspicious module-scope t() calls in a project
grep -rn "^const.*t(" src/ | grep -v "useMemo\|useCallback"
```

Any hit outside a hook is a candidate. Move it into the nearest
component's `useMemo` or convert the surrounding code into a custom
hook.
