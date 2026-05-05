---
id: lsn_0003_supabase_edge_function_no_verify_jwt
title: "Supabase Edge Functions called with supabase-js User-JWTs need --no-verify-jwt; verify in-function instead"
type: debugging_lesson
tier: community
context:
  tools: [supabase, deno]
  languages: [typescript]
  platforms: []
  tags: [supabase, edge-functions, auth, jwt, gateway]
summary: "Supabase's Edge-Functions gateway pre-validates the Authorization Bearer JWT. With supabase-js v2 client tokens this validation is unreliable and frequently rejects valid sessions with a 401 'Invalid JWT' before the function ever runs. Deploy with --no-verify-jwt and verify the user inside the function via auth.getUser()."
problem: |
  An Edge Function called from a freshly logged-in browser session returns:
  ```
  HTTP/1.1 401 Unauthorized
  {"code":401,"message":"Invalid JWT"}
  ```
  even though the user's session is valid (token in localStorage, other Supabase
  RPC calls work). The function code itself never runs — there is no log line
  in `supabase functions logs`. Only the gateway sees the call.

  This typically appears after upgrading `@supabase/supabase-js` or after
  deploying a new Edge Function with the default `verify_jwt=true`.
solution: |
  1. Deploy the function without gateway-level JWT verification:
     ```bash
     supabase functions deploy my-fn --no-verify-jwt
     ```
  2. Verify the JWT inside the function using a request-scoped Supabase
     client that forwards the caller's Authorization header:
     ```ts
     // supabase/functions/my-fn/index.ts
     import { createClient } from "jsr:@supabase/supabase-js@2";

     Deno.serve(async (req) => {
       const auth = req.headers.get("Authorization") ?? "";
       const supabase = createClient(
         Deno.env.get("SUPABASE_URL")!,
         Deno.env.get("SUPABASE_ANON_KEY")!,
         { global: { headers: { Authorization: auth } } },
       );
       const { data: { user }, error } = await supabase.auth.getUser();
       if (error || !user) {
         return new Response(JSON.stringify({ error: "Unauthorized" }), {
           status: 401,
           headers: { "Content-Type": "application/json" },
         });
       }
       // ...real work...
     });
     ```
  3. Distinguish gateway 401 from function 401 by the response body:
     - Body `{"code":401,"message":"Invalid JWT"}` → **gateway**, function did not run
     - Body `{"error":"Unauthorized"}` (or whatever you wrote) → **your function**

  When the bearer is *not* a Supabase JWT — e.g. a custom API key, OAuth
  bearer, or service token — `--no-verify-jwt` is *required*, since the
  gateway only knows how to validate Supabase JWTs.
gotchas:
  - "Don't 'belt and suspenders' this — leaving verify_jwt=true on the gateway *and* re-checking inside the function does not add safety. The gateway rejects valid tokens before your code can do anything."
  - "If you call the function from a Server Component / Server Action with a freshly-fetched `auth.getSession()` token, the gateway is more reliable than from the browser. But the simpler rule — `--no-verify-jwt` plus in-function verification — works in both contexts."
  - "Don't wrap globalThis.fetch globally to add timing/logging. On React Native Web this breaks supabase-js's auth-refresh path with 'Failed to fetch' — apply such wrappers per-call-site instead."
  - "Using `service_role` from the client to dodge JWT issues is a security regression. The fix is `--no-verify-jwt` + `auth.getUser()`, not bypassing user identity altogether."
evidence: "Documented in Supabase issue threads on supabase/cli; the --no-verify-jwt flag is the documented escape hatch (https://supabase.com/docs/guides/functions/auth)."
last_validated_at: "2026-05-05"
tool_versions:
  "supabase-js": "2.x"
  "supabase-cli": "1.x"
upvotes: 0
---

# Background

Supabase's Edge-Functions runtime sits behind a small gateway that, by default,
verifies the `Authorization: Bearer <jwt>` header before forwarding the request
to your Deno code. The intent is convenience: you get auth-gating for free.
The reality is that the gateway's verifier and the supabase-js v2 token format
have drifted enough times that production-grade apps see intermittent 401s on
valid sessions.

The pragmatic answer is to *not* delegate auth to the gateway. Auth is
business logic — it lives in your function, where you can log, branch, and
test it. The gateway just passes the bearer through.

## Diagnosing the symptom

When an Edge Function 401s, the **first** debugging step is to read the
response body, not the status line. Two distinct response shapes correspond
to two completely different failure modes:

| Response body | Meaning | Where to look |
|---|---|---|
| `{"code":401,"message":"Invalid JWT"}` | Gateway rejected pre-function | Re-deploy with `--no-verify-jwt`; check `verify_jwt` in `supabase/config.toml` if used |
| Your own `{"error":"Unauthorized"}` (or similar) | Function ran and rejected | Check the user session in the browser; look at function logs |

Time spent re-tracing your own auth flow when the body is `{"code":401}` is
wasted — your code never executed.

## When NOT to use --no-verify-jwt

If your function only ever receives Supabase JWTs *and* you only call it from
trusted server contexts (a Server Action with `auth.getSession()`, never the
browser), the gateway-level check works fine and saves you a few lines of
code. But once a browser, a custom API-key flow, or a third-party bearer
enters the picture, switch off the gateway check and verify in-function.

## Related practice

- Always log both the gateway path and the function path explicitly when
  introducing a new Edge Function. The first 24 hours of traffic will tell
  you whether the gateway is rejecting anything you didn't expect.
- Pair this lesson with general "always destructure `{ error }` from supabase
  calls" hygiene. Silent swallowed errors and silent gateway 401s are the
  same class of bug — invisible failure at a boundary.
