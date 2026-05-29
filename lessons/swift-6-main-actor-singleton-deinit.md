---
id: lsn_swift_6_main_actor_singleton_deinit
title: Fix Swift 6 strict-concurrency errors in app-level singletons (enum, Sendable, drop deinit)
type: debugging_lesson
tier: community
summary: Three Swift 6 strict-concurrency errors hit every app-level singleton at once. (1) `@Observable class` with `static let shared` rejects as non-Sendable. (2) `nonisolated(unsafe)` opt-outs become redundant warnings as libraries adopt Sendable. (3) `deinit` of a `@MainActor` class cannot reference MainActor-isolated stored properties. The clean pattern uses `enum` for static config and omits `deinit` for app-lifetime singletons.
context:
  tools: []
  languages:
    - swift
  platforms:
    - ios
  tags:
    - swift-6
    - strict-concurrency
    - mainactor
    - sendable
    - singleton
    - observable
---

## Three errors that all hit at once

When you enable `SWIFT_STRICT_CONCURRENCY=complete` (Swift 6 mode) and try to write the natural "shared app config + shared backend client + observable app state" singleton trio, all three patterns fail simultaneously:

```swift
// Pattern 1 — static config
@Observable
final class AppConfig {
    static let shared = AppConfig()
    let supabaseURL: URL
    private init() { ... }
}
// ❌ Static property 'shared' is not concurrency-safe because non-'Sendable'
//    type 'AppConfig' may have shared mutable state

// Pattern 2 — shared backend client
enum SupabaseProvider {
    nonisolated(unsafe) static let shared: SupabaseClient = SupabaseClient(...)
}
// ⚠️ 'nonisolated(unsafe)' is unnecessary for a constant with 'Sendable' type
//    'SupabaseClient', consider removing it
// (after a library update marks the type Sendable)

// Pattern 3 — observable app state
@MainActor @Observable
final class AppState {
    private var sessionTask: Task<Void, Never>?
    init() { sessionTask = Task { ... } }
    deinit { sessionTask?.cancel() }
}
// ❌ main actor-isolated property 'sessionTask' can not be referenced
//    from a nonisolated context
```

Three different root causes, but they show up in the same review pass.

## Root cause per pattern

**Pattern 1:** `@Observable` injects mutable observation state (`_$observationRegistrar`), so the class isn't `Sendable`. `static let` on a non-Sendable type demands a cross-thread-safety proof.

**Pattern 2:** Libraries promote types to `Sendable` between versions. Your defensive `nonisolated(unsafe)` opt-out becomes warning noise as soon as the type carries the conformance.

**Pattern 3:** `deinit` ALWAYS runs in a nonisolated context, even when the class is `@MainActor`-isolated. Swift 6.0 has no stable `nonisolated deinit` (SE-0371 lands in 6.1+). `MainActor.assumeIsolated { ... }` inside `deinit` is unsafe because `deinit` is not guaranteed to run on MainActor.

## The clean fix per pattern

```swift
// Pattern 1 — use enum, not @Observable class
enum AppConfig {
    static let supabaseURL: URL = { /* read Info.plist */ }()
    static let supabaseAnonKey: String = { /* read Info.plist */ }()
}
// Caller: AppConfig.supabaseURL  (no .shared accessor needed)
// → enum is not instantiable, automatically concurrency-safe, no observation overhead

// Pattern 2 — drop the opt-out when the warning appears
enum SupabaseProvider {
    static let shared: SupabaseClient = SupabaseClient(...)
}
// → Library marks SupabaseClient Sendable in 2.46+; plain static let suffices

// Pattern 3 — drop deinit entirely for app-lifetime singletons
@MainActor @Observable
final class AppState {
    init() {
        Task { [weak self] in
            await self?.observeAuthChanges()
        }
    }
    // No deinit — AppState lives for app process lifetime, OS reclaims at process exit.
    // [weak self] in the Task closure prevents the retain cycle.
}
```

The "app lifetime" claim is load-bearing — AppState is instantiated exactly once in `TaxrayApp.body` via `@State`, lives until process exit. If you create multiple instances in tests/previews, the Task lifecycle needs a separate holder (see "When this does NOT apply").

## Why `@Observable` was wrong for static config in the first place

`@Observable` is for state that views observe and react to. Static config is an immutable boot-time snapshot — nothing observes a URL changing because it doesn't change. The compile error is the symptom; the semantic mismatch is the root cause. `enum` is the correct primitive — not instantiable, no macro side effects, automatically concurrency-safe.

## When this does NOT apply

- **You actually need cleanup logic in deinit:** for non-app-lifetime classes (per-screen ViewModels, document-scope objects) you DO want explicit Task cancellation. Pattern is a separate `nonisolated final class TaskHolder` that holds the `Task` and exposes a `nonisolated func cancel()`; reference it from the MainActor class. The MainActor class can have a no-op `deinit` and rely on the holder's `cancel()` being called from its public `dispose()` method that callers invoke before the object becomes unreachable.
- **Tests / previews instantiate the class multiple times:** the "OS handles it at process exit" rationale breaks because each instance leaks its Task. Either add an explicit `dispose()` method that tests call in `tearDown()`, or wait for Swift 6.1's `nonisolated deinit` (SE-0371).
- **Swift 6.1 or later:** if `nonisolated deinit` is stable in your toolchain, the explicit cleanup `deinit` is allowed. Re-evaluate the "drop deinit" pattern at every Swift major bump.
- **Library updates remove Sendable from a type you're using:** rare but possible. The redundant-`nonisolated(unsafe)` warning is your tripwire — once you remove the opt-out, you've also lost the safety net. If the library later removes Sendable, the build fails fast (acceptable signal, not a hidden bug).

Related convention — `lsn_self_authored_agent_doc_routing` (also surfaces the "make the gate visible" pattern in a different context).

## Anti-patterns

- **`MainActor.assumeIsolated { ... }` inside `deinit`:** crashes at runtime if `deinit` is called from a non-MainActor thread (e.g. ARC release on a background queue). Looks like a fix; is a time bomb.
- **`@unchecked Sendable` on the class to silence the static-let error:** weakens the type system globally to fix a local issue. Use `nonisolated(unsafe)` on the specific `static let` instead, or refactor to `enum`.
- **Adding `@MainActor` to `init` to "make the deinit problem go away":** doesn't help. `deinit` is independent of `init`'s isolation; they don't share a context.
- **Treating the redundant-`nonisolated(unsafe)` warning as cosmetic:** stale opt-outs hide real safety issues. When a library's Sendable conformance changes again, the compiler can no longer warn you because the opt-out is unconditional.
