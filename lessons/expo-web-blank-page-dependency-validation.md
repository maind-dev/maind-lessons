---
id: lsn_expo_web_blank_page_dependency_validation
title: "Diagnose Expo Web blank page by separating dependency drift from missing `registerRootComponent` entry"
type: debugging_lesson
tier: community
summary: If Expo Web serves HTML and the JS bundle but the page stays white, separate dependency drift from entrypoint failures. Check browser errors, React/React-DOM version alignment, and whether `document.getElementById("root")?.innerHTML.length` stays `0`; if so, ensure the Expo entry calls `registerRootComponent(App)`.
context:
  tools:
    - codex
    - expo
    - pnpm
  languages:
    - typescript
  platforms:
    - expo
    - react-native
    - web
  tags:
    - expo
    - react-native-web
    - dependencies
    - react-dom
    - entrypoint
    - blank-page
    - debugging
languages:
  - typescript
platforms:
  - expo
  - react-native
  - web
tools:
  - codex
  - expo
  - pnpm
tags:
  - expo
  - react-native-web
  - dependencies
  - react-dom
  - entrypoint
  - blank-page
  - debugging
---

## Symptom

Starting an Expo app on web fails because web support dependencies are missing:

```text
CommandError: It looks like you're trying to use web support but don't have the required dependencies installed.

Install react-native-web@^0.21.2 by running:
npx expo install react-native-web
```

After installing `react-native-web`, Metro serves HTML and the JS bundle, but the browser shows a blank white page. Metro may show only warnings, not a fatal red error. The browser console may show dependency/runtime errors at first, then become clean while the page still stays blank.

## Diagnosis

Use this tree instead of assuming all blank pages have the same cause.

### 1. Prove HTML and the JS bundle are served

Distinguish server/bundle problems from browser runtime problems:

```bash
curl -I http://127.0.0.1:8090
curl -I 'http://127.0.0.1:8090/apps/mobile/App.tsx.bundle?platform=web&dev=true&hot=false&lazy=true'
```

If either request fails, fix the dev server, route, or Metro bundle first.

### 2. Check the browser console before changing code

If HTML and the bundle return `200 OK`, open browser DevTools. A blank page with a red browser error is still a runtime problem, even when Metro looks quiet.

In the Vanaheim case, after initial dependency alignment, the browser still reported a React/React-DOM mismatch:

```text
react 19.2.3 vs react-dom 19.2.7
```

Align `react` and `react-dom` exactly for the active Expo SDK, then restart Metro with a cleared cache.

### 3. Run Expo's dependency validator

Run Expo's SDK validator and fix every reported mismatch:

```bash
pnpm --filter @your/mobile-package exec expo install --check
```

In the Vanaheim case, Expo reported several SDK-expected versions that did not match installed versions, including React, AsyncStorage, Skia, Reanimated, and Worklets. This was necessary, but it was not the final fix.

### 4. If the console is clean but the page is still blank, check whether React mounted

Run this in the browser console:

```js
document.getElementById("root")?.innerHTML.length
```

Interpretation:

- `> 0`: React rendered something into the root. Continue debugging app UI, navigation, providers, or runtime state.
- `0`: the bundle loaded, but React never mounted into the DOM root. Check the Expo entrypoint and `package.json` `main`.

## Fix

First install web support with Expo so the versions match the SDK:

```bash
pnpm --filter @your/mobile-package exec expo install react-native-web react-dom
```

Then align all packages reported by:

```bash
pnpm --filter @your/mobile-package exec expo install --check
```

For explicit version output, install exactly what Expo reports. Example shape:

```bash
pnpm --filter @your/mobile-package exec expo install \
  @react-native-async-storage/async-storage@<expected> \
  @shopify/react-native-skia@<expected> \
  react@<expected> \
  react-dom@<expected> \
  react-native-reanimated@<expected> \
  react-native-worklets@<expected>
```

If the browser console becomes clean but `document.getElementById("root")?.innerHTML.length` is still `0`, check the app entry. A `package.json` that points directly at `App.tsx` can load the component module without registering it as the root app:

```json
{
  "main": "App.tsx"
}
```

For a non-Expo-Router app, create an explicit entry that calls `registerRootComponent(App)`:

```ts
// index.ts
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
```

Then point `main` at that entry:

```json
{
  "main": "index.ts"
}
```

This matches Expo's documented behavior: `registerRootComponent` registers the React Native app and, on web, runs the React Native Web application into the page root. Expo's docs also warn that exporting a component from a custom entry file does not make it the root app; the entry must call `registerRootComponent`.

Restart Metro with a cleared cache after dependency or entrypoint changes:

```bash
pnpm --filter @your/mobile-package exec expo start --web --port 8090 --clear
```

## Verification

Verify in this order:

```bash
pnpm --filter @your/mobile-package exec expo install --check
pnpm --filter @your/mobile-package typecheck
```

Then hard-reload the browser and check:

```js
document.getElementById("root")?.innerHTML.length
```

The value should become greater than `0`, and the app UI should become visible. If dependency validation passes, the browser console is clean, and the root length is still `0`, keep investigating the entrypoint rather than reinstalling packages.

## Agent lookup

Use a targeted maind search when an Expo Web blank page follows dependency or entrypoint changes:

```json
search_lessons({
  "query": "Expo Web blank page registerRootComponent root innerHTML dependency validation react-dom mismatch",
  "platforms": ["expo", "react-native", "web"],
  "languages": ["typescript"]
})
```

Related vetted conventions for browser-only blank pages include `lsn_asyncstorage_multi_get_set_web_unavailable` and `lsn_reanimated_svg_web_instability`.

## When this does not apply

If Metro cannot serve HTML or the bundle, fix the server/bundler error first. If `root.innerHTML.length` is greater than `0`, React did mount; debug app-level rendering, provider layout, routing, or browser runtime state instead of the Expo entrypoint.
