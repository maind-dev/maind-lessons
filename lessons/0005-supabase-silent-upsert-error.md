---
id: lsn_0005_supabase_silent_upsert_error
title: "supabase.from(...).upsert(...) without `{ error }` destructuring silently swallows DB errors (missing columns, constraints, RLS)"
type: workflow_best_practice
tier: community
context:
  tools: [supabase]
  languages: [typescript, javascript]
  platforms: []
  tags: [supabase, postgrest, error-handling, silent-failure, edge-functions]
summary: "`await supabase.from('t').upsert(payload)` resolves to `{ data, error }`. If you don't destructure and check `error`, the call appears to succeed even when PostgREST returned 400 (missing column, constraint violation, RLS denial). Edge Functions that deploy ahead of their migrations fail invisibly this way."
problem: |
  An Edge Function looks correct in code review:
  ```ts
  await supabase.from('snapshots').upsert({
    user_id, last_run_at, snapshot_code_version: VERSION
  }, { onConflict: 'user_id' });

  return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  ```
  It logs `status: ok`. CloudWatch shows 200s. Application "succeeds." But the
  `snapshots.last_run_at` column never advances and the next run re-processes
  the same data.

  Root cause: a column in the payload (`snapshot_code_version`) was added in
  code but the migration was not yet applied in this region — PostgREST
  returned a 400 with `column "snapshot_code_version" does not exist`. Because
  the JS code did not destructure `error`, the rejection was swallowed and the
  function returned 200.
solution: |
  **Always destructure `{ error }` from every `from(...)` call** —
  `.upsert()`, `.insert()`, `.update()`, `.delete()`, `.select()` — and
  surface the error explicitly:

  ```ts
  // ✗ silent
  await supabase.from('snapshots').upsert(payload);

  // ✓ loud
  const { error } = await supabase.from('snapshots').upsert(payload);
  if (error) {
    console.error('[snapshots] upsert failed:', error.code, error.message);
    throw new Error(`upsert failed: ${error.message}`);
  }
  ```

  For optional columns added in code ahead of their migration, do a one-shot
  retry without the new field so the function degrades gracefully:
  ```ts
  let { error } = await supabase.from('snapshots').upsert({
    user_id, last_run_at, snapshot_code_version: VERSION
  });
  if (error && /column.*does not exist/i.test(error.message)) {
    ({ error } = await supabase.from('snapshots').upsert({
      user_id, last_run_at
    }));
  }
  if (error) {
    console.error('[snapshots] upsert failed:', error.code, error.message);
    throw error;
  }
  ```

  In code review, treat any `await supabase.from(...)` not preceded by
  `const { error }` (or `const { data, error }`) as a defect.
gotchas:
  - "TypeScript does not catch this — `await` on a Promise<{data, error}> is a valid expression that simply discards the resolved value."
  - "`{ data }` without `{ error }` is just as wrong. Both fields exist on every response; checking only `data` masks failures."
  - "RLS denials surface as `error.code === 'PGRST116'` (no rows) or 401/403 in newer versions — also silently swallowed if you skip destructuring."
  - "Constraint-violation errors (unique, foreign-key) are real Postgres `42xxx`/`23xxx` codes returned via PostgREST. They look identical at the JS level — only `error.code`/`error.message` distinguishes them."
  - "Don't rely on `.throwOnError()` alone unless you've reviewed every call site — older code that depends on graceful-degradation may break under it."
evidence: "Reproducible across supabase-js 2.x. PostgREST error format: https://docs.postgrest.org/en/latest/errors.html"
last_validated_at: "2026-05-05"
tool_versions:
  "supabase-js": "2.x"
  postgrest: "12.x"
upvotes: 0
---

# Background

The supabase-js client adopts a Go-style `{ data, error }` return convention
on every query. It does not throw on PostgREST-level errors — by design,
because some "errors" (e.g. no-rows-on-`.single()`) are normal flow control.
The cost of that design is that any `await` that doesn't destructure can mask
a 400/403/409 indistinguishably from a 200.

Edge Functions are particularly vulnerable because:
- they often run unattended (cron, webhooks),
- their only feedback to the rest of the system is a return value or a state
  table they wrote into — and if that write was silently rejected, the only
  signal is "nothing happened,"
- they are deployed independently of database migrations, so column-drift
  between code and schema is a normal transient state.

## Code-review checklist

Whenever you see `supabase.from(...)` in a PR diff:
1. Is the result destructured to include `error`?
2. If `error` is checked, does the failure path log `error.code` and
   `error.message` (not just a generic string)?
3. If the call is in a loop or batch, does *any* error abort the batch, or is
   the loop continuing past failures?

## Minimal pattern library

```ts
// One-off insert / upsert / update
const { error } = await supabase.from('t').upsert(payload);
if (error) throw new Error(`upsert ${table}: ${error.message}`);

// Single read with throw-on-missing
const { data, error } = await supabase.from('t').select('*').eq('id', id).single();
if (error) throw new Error(`fetch ${id}: ${error.message}`);

// Bulk read where partial failure should not abort
const { data, error } = await supabase.from('t').select('*').in('id', ids);
if (error) console.error(`bulk fetch failed: ${error.message}`);
const rows = data ?? [];
```

The verbosity is the point. Silent success is more dangerous than a stack
trace.

## Related anti-pattern

`supabase.functions.invoke()` has the same shape — `{ data, error }` — and
hides the actual response body of HTTP 4xx errors inside `error.context`.
The same destructure-and-check rule applies, plus an extra step to read
`error.context.clone().json()` if you need the structured error body.
