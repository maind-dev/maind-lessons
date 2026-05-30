---
id: lsn_coolify_buildtime_toggle_public_envs
title: Fix Coolify `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` vars missing from the bundle — toggle "Available at Buildtime"
type: debugging_lesson
tier: community
lesson_class: architecture
quality_tier: hand-vetted
context:
  tools:
    - coolify
    - docker
    - expo
    - nextjs
  languages: []
  platforms:
    - coolify
  tags:
    - coolify
    - build-args
    - public-env-vars
    - deployment
summary: >-
  Coolify env vars default to runtime-only. Frameworks that inline
  public env vars at build time (Expo `EXPO_PUBLIC_*`, Next `NEXT_PUBLIC_*`,
  Vite `VITE_*`) need the "Available at Buildtime" toggle enabled
  explicitly — otherwise the value reaches the running container but
  not the JS bundle, and `process.env.X` is `undefined` in the browser.
  Plus the Dockerfile needs the matching `ARG`/`ENV` pair so the build
  step actually consumes the build arg.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The symptom

You set `EXPO_PUBLIC_TURNSTILE_SITE_KEY` (or any `EXPO_PUBLIC_*` /
`NEXT_PUBLIC_*` / `VITE_*` variable) in Coolify's environment-variables
panel. You redeploy. The variable is "present" — the runtime shell
sees it — but in the browser:

```javascript
console.log(process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY)
// → undefined
```

Or you see the widget/feature initialise with the literal placeholder
string from your code (`""` or `"REPLACE_ME"`), not the real key.

The deploy looked fine. The container runs. The frontend still acts
like the variable isn't set.

## What's actually happening

Frameworks that prefix public env vars with `EXPO_PUBLIC_` / `NEXT_PUBLIC_`
/ `VITE_` inline them into the JS bundle at **build time**, not runtime.
Once `npm run build` (or `expo export -p web`) has run, the JS files
contain literal strings — the runtime container can't inject anything
into them anymore.

Coolify environment variables, by default, are exposed only to the
running container — not to the `docker build` step. The toggle to
change that is per-variable and easy to miss:

```
[Coolify → Service → Environment Variables → <your var>]
☐  Is Literal
☐  Is Multiline
☑  Available at Runtime    ← default
☐  Available at Buildtime  ← MUST be on for EXPO_PUBLIC_* / NEXT_PUBLIC_*
```

Without `Available at Buildtime`, the build step sees no variable, the
bundle is built with the empty/placeholder default, and runtime
injection is impossible because the JS files are already minified
strings.

## The fix

For each public env var:

1. **Toggle on:** `Available at Buildtime ✅`. Runtime is optional —
   for static-build apps (Expo Web export, Next static export, Vite
   build) the runtime container doesn't need the variable at all.
2. **Trigger a rebuild.** Coolify does not rebuild automatically on
   env-var toggle changes. Click `Redeploy` (or push a noop commit).
3. **Verify the Dockerfile** declares the matching `ARG` + `ENV` lines:

   ```dockerfile
   # Build stage
   ARG EXPO_PUBLIC_TURNSTILE_SITE_KEY
   ENV EXPO_PUBLIC_TURNSTILE_SITE_KEY=$EXPO_PUBLIC_TURNSTILE_SITE_KEY
   RUN npm run build
   ```

   Without `ARG`, Docker ignores the build-arg even if Coolify passes
   it. Without `ENV`, the `RUN npm run build` step can't see it.

The `ARG` declaration must be inside the build stage that runs `npm run build` — not earlier (where it's out of scope) or only in the final runtime stage (where it's too late). If you put `ARG` in the runtime stage, the variable is undefined during `npm run build`. Same symptom as missing the Coolify toggle.

## Verification

In the browser console on the live URL:

```javascript
console.log(process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY)
// → "0x4AAAAAAA…"   ✓ value present, build picked it up
// → undefined        ✗ rebuild was missed, or ARG/ENV pair is missing
// → ""               ✗ buildtime toggle still off, build saw empty
```

If the value still doesn't appear after toggling buildtime and redeploying, check the Dockerfile and the build log. Coolify's build output sometimes swallows npm errors — reproduce locally with `docker build --progress=plain --no-cache` to see what the build step actually saw.

## When this does not apply

- **Private (server-only) env vars** like `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`. These should NOT be at buildtime — they belong in runtime only, otherwise they end up in the public bundle.
- **Server-rendered Next.js apps** that read env vars at request time (without `NEXT_PUBLIC_` prefix). Runtime exposure is correct there.
- **Apps using Coolify's "magic variables"** (`COOLIFY_FQDN`, `SERVICE_URL_*`). Those are injected automatically; the toggle doesn't apply.
