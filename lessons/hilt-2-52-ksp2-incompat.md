---
id: lsn_hilt_2_52_ksp2_incompat
title: Diagnose Hilt 2.52 'Did you forget the Gradle Plugin?' as a KSP2 incompatibility
type: debugging_lesson
tier: community
summary: Hilt 2.52 has incomplete KSP2 support. When `ksp.useKSP2=true` is set (default in newer KSP versions), Hilt's annotation processor throws `Expected @HiltAndroidApp to have a value. Did you forget to apply the Gradle Plugin?` — even when the plugin IS correctly applied. The error message points at the wrong cause. Fix is `ksp.useKSP2=false` in `gradle.properties`.
context:
  tools: []
  languages:
    - kotlin
  platforms:
    - android
  tags:
    - hilt
    - dagger
    - ksp
    - annotation-processor
    - misleading-error
---

## Symptom

`./gradlew assembleDebug` fails at the KSP-Kotlin task:

```
e: [ksp] [Hilt] Expected @HiltAndroidApp to have a value.
        Did you forget to apply the Gradle Plugin?
        (com.google.dagger.hilt.android)
See https://dagger.dev/hilt/gradle-setup.html
[Hilt] Processing did not complete. See error above for details.

> Task :app:kspDebugKotlin
> A failure occurred while executing com.google.devtools.ksp.gradle.KspAAWorkerAction
   > KSP failed with exit code: PROCESSING_ERROR
```

The natural reaction is to check the Gradle plugin application — and find it correct:

```kotlin
// app/build.gradle.kts
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.hilt)            // ← applied
    alias(libs.plugins.ksp)
}

dependencies {
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)              // ← compiler wired
}
```

```kotlin
// TaxrayApplication.kt
@HiltAndroidApp                          // ← annotation present
class TaxrayApplication : Application()
```

Everything is correct. The Hilt error message is misleading.

## Root cause

Hilt 2.52 has only partial KSP2 support. KSP2 (Kotlin Symbol Processing v2, default in Kotlin 2.1+ when `ksp.useKSP2=true`) changed the signature of `KSAnnotated.getAnnotationValue()` and a few related APIs. Hilt's annotation processor calls these via reflection-style adapters; under KSP2, the call returns an empty Optional where KSP1 returned a populated one. Hilt interprets the empty value as "the @HiltAndroidApp annotation has no value to read" — which it lazily phrases as "did you forget the Gradle plugin?".

The error is symptom-of-symptom: empty annotation read → assumed missing plugin → wrong remediation hint to the user.

## Fix

In `gradle.properties`:

```properties
# Hilt 2.52 has incomplete KSP2 support — staying on KSP1 until Hilt 2.55+
ksp.useKSP2=false
```

Build runs clean. KSP1 is mature, well-supported by every annotation processor in the Android ecosystem.

## When this does NOT apply

- **Hilt 2.55 or newer:** KSP2 support is broadly there. Re-enable `ksp.useKSP2=true` and the build should still pass. Bump and re-test on every Hilt major update.
- **No Hilt in the project:** other KSP-using libraries (Room, Moshi-codegen, kotlinx-serialization-ksp) all have their own KSP2-compat matrices. If only Hilt is the culprit, the workaround scope is the same; if multiple processors fail, audit each independently.
- **KSP1 explicitly chosen:** if `ksp.useKSP2=false` is already set (older Kotlin versions where it was default), this convention doesn't fire because you're not on KSP2 in the first place.

Related convention in the same Android-build pipeline: `lsn_agp_8_jdk_22_silent_reject` (JVM-version reject before the KSP step even starts).

## Anti-patterns

- **Auditing the Gradle plugin setup repeatedly:** the error literally tells you to check the plugin, so first-time debuggers spend 20-30 minutes verifying what is already correct. Resist the urge — check `ksp.useKSP2` first, plugin setup second.
- **Bumping Hilt one version at a time hoping for a fix:** Hilt 2.52 → 2.53 → 2.54 all have incomplete KSP2 support. The fix is either 2.55+ OR the KSP1 fallback. Two-version jump beats incremental probing.
- **Switching from KSP back to KAPT:** KAPT is legacy and ~2-4× slower than KSP. The fix is "use KSP1", not "use KAPT". `ksp.useKSP2=false` keeps you on KSP1, which is faster than KAPT and Hilt-compatible.
- **Reporting the issue to your team as "Hilt plugin broken":** spreads the wrong diagnosis. The plugin works; the KSP2 toolchain is the issue. Communicating the correct cause prevents your colleagues from repeating the 30-minute audit.
