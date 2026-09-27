---
id: lsn_ios_supabase_magic_link_deep_link
title: "Fix a Supabase magic link that never signs the iOS app in — four layers must all line up"
type: debugging_lesson
tier: community
summary: "Four layers must all line up for a Supabase magic-link confirmation URL (yourapp://auth-callback?...) to land in the iOS app and establish a session. (1) CFBundleURLTypes in Info.plist registers the URL scheme. (2) .onOpenURL on the SwiftUI Scene receives the URL. (3) auth.session(from: url) parses tokens and persists the session. (4) Supabase auth-config additional_redirect_urls must allowlist the scheme. Any missing layer = silent fail; the app stays on the sign-in screen."
context:
  tools: []
  languages:
    - swift
  platforms:
    - ios
    - supabase
  tags:
    - deep-link
    - magic-link
    - auth
    - supabase
    - swiftui
    - url-scheme
last_validated_at: "2026-05-20"
---

## The four-layer pipeline

```
Sign-in screen → signInWithOTP(redirectTo: yourapp://auth-callback)
   → Supabase auth-server checks additional_redirect_urls allowlist (Layer 4)
   → Server sends email containing /auth/v1/verify?...&redirect_to=yourapp%3A%2F%2F...
User clicks link in inbox-app → browser opens the verify URL
   → server confirms + 302-redirects to yourapp://auth-callback#access_token=...
iOS sees yourapp:// scheme → looks up CFBundleURLTypes handler (Layer 1)
   → routes to the registered app
App receives URL via Scene's .onOpenURL (Layer 2)
   → calls auth.session(from: url) (Layer 3)
   → supabase-swift parses fragment, persists Session in iOS Keychain
   → authStateChanges fires .signedIn → UI updates
```

Each layer is silent on failure. Wrong scheme casing? iOS doesn't route. Missing `.onOpenURL`? URL lands at the AppDelegate but supabase-swift never sees it. Missing allowlist entry? Server silently redirects to `site_url` instead. The app just sits on the sign-in screen.

## Layer 1 — CFBundleURLTypes via XcodeGen project.yml

```yaml
targets:
  YourApp:
    info:
      path: Sources/YourApp/Resources/Info.plist
      properties:
        CFBundleURLTypes:
          - CFBundleTypeRole: Editor
            CFBundleURLName: app.yourapp.ios.auth-callback
            CFBundleURLSchemes: [yourapp]
```

For hand-maintained `.xcodeproj`, add via the GUI under Target → Info → URL Types. For XcodeGen, putting it in `info.properties` survives the next `xcodegen generate`.

## Layer 2 — .onOpenURL in the Scene

```swift
@main
struct YourApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .onOpenURL { url in
                    Task {
                        do {
                            try await SupabaseProvider.shared.auth.session(from: url)
                        } catch {
                            print("⚠️ Failed to parse auth URL: \(error)")
                        }
                    }
                }
        }
    }
}
```

`.onOpenURL` fires for any URL routed to the app by iOS. The `Task` wrapper is needed because `auth.session(from:)` is async.

## Layer 3 + Layer 4 — Server-side session parse, auth allowlist

`session(from:)` (supabase-swift 2.x) extracts `access_token` + `refresh_token` from the URL fragment, validates them with the auth server, and persists the session in the iOS Keychain. Subsequent app launches read the session from Keychain — user stays signed-in across restarts. If you don't call `session(from:)`, the tokens float in `.onOpenURL`'s closure without effect.

Layer 4 — the server-side allowlist — is the hardest of the four to diagnose:

```toml
# supabase/config.toml  (local)  — OR equivalent in cloud Auth dashboard
[auth]
site_url = "http://localhost:3000"
additional_redirect_urls = ["yourapp://auth-callback"]
```

If `additional_redirect_urls` doesn't contain the scheme exactly (including subdomain/path), the server SILENTLY substitutes `site_url` into the email link. The user clicks → browser opens a page → no deep-link, no session, no error message anywhere.

## When this does NOT apply

- **You use Universal Links instead of Custom URL Scheme:** `https://yourapp.com/auth-callback` is the modern, more-secure pattern (Apple's `apple-app-site-association` file proves you own the domain, prevents scheme hijacking). Trade-off — Universal Links need an actual deployed `https://yourapp.com/.well-known/apple-app-site-association` file and an Apple Developer Team ID. Custom URL Schemes work without any of that, suitable for MVP / TestFlight / internal beta. Phase 2 upgrade is the typical path.
- **Testing in Mac browser:** the Mac browser doesn't know your app's custom scheme. The deep-link test must happen in the iOS Simulator's own Safari (Cmd+Shift+H → Safari → load Mailpit / your email host).
- **First-time signup vs returning login:** the first OTP request on an unseen email triggers a "Confirm Your Email" template (signup flow); a subsequent call on a confirmed user sends a "Magic Link" template. Both go through the same deep-link callback — but they look different in the inbox.

Related: [[lsn_xcodegen_project_yml_footguns]] — the Info.plist regeneration behaviour that drops CFBundleURLTypes when it sits in the wrong place. On the local-config side, note that the Supabase CLI moved several auth keys between major versions, so check your CLI's own config schema before trusting an older guide about where `additional_redirect_urls` belongs.

## Anti-patterns

- **Putting CFBundleURLTypes directly in the generated Info.plist when using XcodeGen:** it gets wiped on the next regen. Always in `project.yml`'s `info.properties`.
- **Forgetting to call `auth.session(from: url)` and just logging the URL:** the URL contains everything supabase-swift needs, but doesn't read it on its own. Without the explicit call, the tokens are lost.
- **Asking the user to manually copy/paste the OTP code from the email as a workaround:** the OTP code in the email is for browser-OTP flows, not for app-flows. Better to fix the deep-link pipeline than to add a 6-digit-code input field that bypasses it.
- **Debugging in the Mac browser:** test in the Simulator's Safari, otherwise the scheme handler never engages.

```js
search_lessons({ query: "supabase magic link ios deep link url scheme onOpenURL session", platforms: ["ios"] })
```
