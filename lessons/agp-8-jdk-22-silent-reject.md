---
id: lsn_agp_8_jdk_22_silent_reject
title: AGP 8.7 rejects Gradle daemon JVM ≥ 22 with cryptic version-number error
type: debugging_lesson
tier: community
summary: Android Gradle Plugin 8.7.x rejects the Gradle-daemon JVM when it is JDK 22 or newer. The "What went wrong" message is just the JVM version (e.g. `26.0.1`) with no explanation. Foojay-toolchain-resolver does NOT fix this — it only handles `jvmToolchain(N)` source-compilation, not the daemon JVM. Install openjdk@17 and pin `JAVA_HOME`.
context:
  tools: []
  languages:
    - kotlin
    - java
  platforms:
    - android
  tags:
    - android-gradle-plugin
    - jdk
    - gradle-daemon
    - toolchain
    - silent-failure
---

## Symptom and root cause

After running `brew install gradle` (which pulls the latest `openjdk` formula, currently OpenJDK 26 on macOS), `./gradlew assembleDebug` fails with a stack trace whose entire "What went wrong" payload is the JVM version number:

```
* What went wrong:
26.0.1

* Try:
> Run with --stacktrace option to get the stack trace.
```

No explanation, no link to a docs page, no hint at AGP. First-time reaction is "WTF is `26.0.1`?".

AGP 8.7.x ships with a hardcoded version-compat check on the Gradle-daemon JVM. JDK 17 and JDK 21 are accepted; JDK 22+ is rejected. The check runs inside the Android plugin's project-configuration phase, where standard Gradle error reporting flattens the underlying `IllegalStateException` to just the JVM version string.

The crucial nuance: AGP checks the **daemon JVM**, not the source-compilation toolchain. So `jvmToolchain(17)` in `app/build.gradle.kts` does NOT save you — the daemon is still running on JDK 26 from `JAVA_HOME`, and AGP rejects it before any toolchain resolution happens.

## Fix

Install JDK 17 explicitly and pin `JAVA_HOME` to it:

```bash
brew install openjdk@17                                # ~150 MB, keg-only formula
echo 'export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home' >> ~/.zshrc
source ~/.zshrc
java --version                                          # → openjdk 17.x — not 26.x
./gradlew assembleDebug                                 # → BUILD SUCCESSFUL
```

JDK 21 also works. JDK 22+ is rejected by AGP ≤ 8.7. AGP 9.0 may change the constraint.

## Why Foojay-toolchain-resolver isn't enough

`foojay-resolver-convention` (in `settings.gradle.kts`) is widely promoted as "the fix" for missing toolchain JDKs. It downloads the requested JDK for `jvmToolchain(N)` blocks. But that only affects source compilation — the Gradle daemon itself runs on whatever JVM `JAVA_HOME` points at. AGP's daemon-JVM check happens before any toolchain block is even evaluated. Foojay is necessary (you want JDK 17 for compilation even if `JAVA_HOME` points at a different version), but not sufficient.

If you're hitting the cryptic `26.0.1` error AND you have foojay-resolver configured, the daemon JVM is the issue — not the toolchain.

**Related gotcha:** if your system Gradle is 9.x (brew default since 2025) and your wrapper is 8.10.x, foojay-resolver versions ≤ 0.9.0 fail with `Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field 'IBM_SEMERU'`. Foojay 1.0.0 (May 2025) removes the IBM_SEMERU reference. On system Gradle 9.x: pin foojay to 1.0.0 minimum.

## When this does NOT apply

- **Android Studio-only builds:** Studio bundles its own JDK 17 internally and runs Gradle daemons on that, regardless of system `JAVA_HOME`. If you build only via Studio's Run button and never touch the terminal, the system `JAVA_HOME` is irrelevant. The fix matters as soon as ANY CLI build (CI, local `./gradlew`, fastlane, Bitrise) enters the picture.
- **AGP ≥ 9.0 (when released):** the constraint may be relaxed or shifted. Re-check on major AGP bumps.
- **Non-AGP Gradle projects:** plain Kotlin/JVM libraries don't have this constraint — JDK 26 works fine there. The check is AGP-specific.

Related lessons in the same Android-build pipeline: `lsn_hilt_2_52_ksp2_incompat` (Hilt-annotation-processor failure after fixing the JDK).

## Anti-patterns

- **Bumping the wrapper Gradle version "to fix the AGP error":** the daemon JVM is the issue, not Gradle. A newer Gradle still runs on JDK 26 if `JAVA_HOME` says so, and AGP still rejects it.
- **Trying every JDK from brew sequentially:** the matrix is small (17, 21 OK; 22+ not OK for AGP 8.7). Read AGP release notes, pick JDK 17, move on.
- **Treating the IDE-only fix as sufficient:** Android Studio's bundled JDK fixes the IDE but breaks CLI parity. Set system `JAVA_HOME` even if you primarily use the IDE — every contributor needs CLI builds for CI eventually.
