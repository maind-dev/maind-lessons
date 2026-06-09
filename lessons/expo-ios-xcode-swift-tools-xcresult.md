---
id: lsn_expo_ios_xcode_swift_tools_xcresult
title: "Diagnose Expo iOS `xcodebuild` error 65 by inspecting the xcresult for Swift tools mismatches"
type: debugging_lesson
tier: community
summary: When `expo run:ios` exits with `xcodebuild` code 65 but the Expo log says "0 error(s)", inspect the generated `.xcresult`. Swift Package tools-version mismatches can surface only there, so compare `Package.swift` requirements against the active Xcode/Swift toolchain.
context:
  tools:
    - codex
    - xcode
    - expo
  languages:
    - typescript
    - swift
  platforms:
    - expo
    - react-native
    - ios
  tags:
    - expo
    - ios
    - xcode
    - swift
    - xcresult
    - debugging
languages:
  - typescript
  - swift
platforms:
  - expo
  - react-native
  - ios
tools:
  - codex
  - xcode
  - expo
tags:
  - expo
  - ios
  - xcode
  - swift
  - xcresult
  - debugging
---

## Symptom

`expo run:ios` fails with error 65, but the visible Expo output is misleadingly clean:

```text
0 error(s), and 1 warning(s)
CommandError: Failed to build iOS project. "xcodebuild" exited with error code 65.
```

Grepping the captured Expo log for `error:`, `fatal`, `Undefined symbols`, `ld:`, `CompileC`, or `SwiftCompile` finds only the wrapper error. CocoaPods and Skia may already be installed correctly.

## Diagnosis

Look for the `.xcresult` bundle Xcode wrote, then inspect it directly:

```bash
ls -lt "$TMPDIR" | grep ResultBundle | head

xcrun xcresulttool get \
  --legacy \
  --format json \
  --path "$TMPDIR/ResultBundle_<timestamp>.xcresult"
```

In the Vanaheim case, the real failure was inside `actionResult.issues.testFailureSummaries`:

```text
Could not resolve package dependencies:
  package 'apple' is using Swift tools version 6.2.0 but the installed version is 6.0.0
```

Confirm the active toolchain:

```bash
xcodebuild -version
swift --version
```

Also inspect generated/native package manifests when needed:

```bash
find . -name Package.swift -print |
  xargs grep -n "swift-tools-version"
```

For Expo/React Native projects, a package such as `expo-modules-jsi/apple/Package.swift` can declare a newer Swift tools version than the active Xcode supports.

As of 2026-06-08, the official Expo SDK reference lists SDK 56 as requiring Xcode 26.4+, SDK 55 as requiring Xcode 26.2+, and SDK 54 as requiring Xcode 16.1+. Apple's Xcode support table shows Xcode 16.1/16.2 ship Swift 6.0, while Xcode 26.x ships Swift 6.2 or newer. Treat these as dated examples: the durable check is the local package's `swift-tools-version` against the active `swift --version`.

## Fix

Do not keep reinstalling Pods once the `.xcresult` shows a Swift tools mismatch. Align the Apple toolchain with the Expo SDK's iOS requirements:

1. Verify the current Xcode requirement in the official Expo SDK docs.
2. Cross-check Apple's Xcode support table to confirm which Swift compiler that Xcode ships.
3. Install an Xcode version that ships the required Swift tools version.
4. Activate it if multiple Xcodes are installed:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -version
swift --version
```

5. Regenerate pods after switching Xcode:

```bash
cd apps/mobile
pod install --repo-update --project-directory=ios
pnpm exec expo run:ios
```

If the machine cannot run a compatible Xcode, choose explicitly between upgrading macOS, using EAS/cloud builds, or downgrading the Expo SDK to a version compatible with the local Xcode.

## Agent lookup

Use a targeted maind search before assuming this is a Pods problem:

```json
search_lessons({
  "query": "Expo iOS xcodebuild error 65 xcresult Swift tools Xcode mismatch",
  "platforms": ["expo", "react-native", "ios"],
  "languages": ["swift", "typescript"]
})
```

For the broader debugging posture around wrapper commands that hide the real failure, see `lsn_surface_silent_errors_first`.

## Verification

The key verification is that `swift --version` reports a tools version at or above the package's `swift-tools-version`, then `expo run:ios` gets past package resolution. If it still fails, capture a fresh `.xcresult` and treat it as a new error instead of assuming the CocoaPods/Swift mismatch is still the active blocker.

## When this does not apply

This is not the first diagnosis for ordinary compiler errors that appear directly in the Expo or Xcode log. Use it when the Expo wrapper reports error 65 with little or no actionable error text, especially when the `.xcactivitylog` is empty or incomplete and Xcode wrote a `ResultBundle_*.xcresult`.
