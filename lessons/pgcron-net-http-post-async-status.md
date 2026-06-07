---
id: lsn_pgcron_net_http_post_async_status
title: Diagnose a silently-failing pg_cron HTTP trigger — status is in `net._http_response`, not `job_run_details`
type: debugging_lesson
tier: community
summary: A pg_cron job whose command is `SELECT net.http_post(...)` reports `status='succeeded'` (return_message `1 row`) the moment the request is queued — `net.http_post` is asynchronous and returns a bigint request-id, not the HTTP outcome. The actual status code (200/401/500) and body live in pg_net's `net._http_response`. Verifying an HTTP-triggering cron via `cron.job_run_details` gives false confidence; a job that 401s every tick still shows `succeeded`.
context:
  languages: [sql]
  platforms: [postgres, supabase]
  tags: [pg_cron, pg_net, net-http-post, cron, async, debugging]
---

## The trap

The standard Supabase pattern for a scheduled webhook / Edge-Function trigger is a pg_cron job whose command is a `net.http_post`:

```sql
SELECT cron.schedule('ping-endpoint', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://<ref>.functions.supabase.co/my-fn',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
```

You then "confirm it works" by reading the cron history:

```sql
SELECT status, return_message, start_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'ping-endpoint')
ORDER BY start_time DESC LIMIT 5;
-- status='succeeded', return_message='1 row'  ← looks healthy
```

It is **not** a health signal. The endpoint can be returning 401 (bad secret), 404 (not deployed), or 500 on every single tick, and `cron.job_run_details` will still show `succeeded` / `1 row` forever.

## Why

`net.http_post` (pg_net) is **asynchronous**. It does not perform the HTTP call inline — it enqueues the request and immediately returns a `bigint` request-id. A pg_net background worker makes the actual call later. So:

- `cron.job_run_details.status` only reflects whether the cron **command** (`SELECT net.http_post(...)`) executed without a SQL error.
- That `SELECT` always succeeds and returns one row (the request-id) → `status='succeeded'`, `return_message='1 row'`.
- The HTTP response — status code, body, timeout, transport error — is decoupled and lands in pg_net's response table afterwards.

`succeeded` here means "the request was queued", not "the endpoint answered 2xx".

## The correct verification

Read the actual HTTP outcome from `net._http_response`:

```sql
SELECT id, status_code, error_msg, content_type,
       left(content, 200) AS body_preview, created
FROM net._http_response
ORDER BY created DESC
LIMIT 5;
```

- `status_code` is the real HTTP code (200 / 401 / 404 / 500).
- `content` is the response body — for a JSON API this is where the actual `{"error":"..."}` lives.
- `error_msg` / `timed_out` cover transport-level failures (DNS, connection refused, timeout).

For a definitive end-to-end check, trigger the same call you cron'd directly (e.g. `curl -X POST` the endpoint) so you see the HTTP status synchronously — the cron path and the curl path hit the same handler.

## Detection — symptom to cause

| Symptom | What it actually means |
|---|---|
| Cron shows `succeeded` every tick, but the endpoint/Edge Function "never runs" or its side-effect never happens | The HTTP call is failing (401/404/500); `job_run_details` cannot see it. Check `net._http_response`. |
| Endpoint works when you `curl` it, but the scheduled path silently does nothing | Same — the cron fires, the request is queued, the response (likely an auth/route error) is only in `net._http_response`. |

## When this does NOT apply

If the cron command is **pure SQL** (e.g. `REFRESH MATERIALIZED VIEW`, `DELETE`, a `SELECT my_rpc(...)` that does the work in-process), then `cron.job_run_details.status` **does** reflect success/failure — the command raises on error and the run is marked `failed`. The async-decoupling is specific to `net.http_post` / `net.http_get` (pg_net). So:

- SQL-command cron → `job_run_details` is authoritative (see [[lsn_postgres_mv_exists_check_unpopulated]], which reads it correctly for a failing `REFRESH`).
- `net.http_post` cron → `job_run_details` is a false positive for the HTTP layer; use `net._http_response`.

This is a specific instance of the broader rule: a tool's success message can lie — verify side-effects from a second source ([[lsn_verify_cli_side_effects_second_source]]).

## Find this from a symptom

```js
search_lessons({ query: "pg_cron net.http_post succeeded but endpoint 401 net._http_response", platforms: ["supabase", "postgres"] })
```
