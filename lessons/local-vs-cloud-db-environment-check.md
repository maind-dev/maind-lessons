---
id: lsn_local_vs_cloud_db_environment_check
title: Confirm DB environment + user before every SQL action — local and cloud Studios look identical
type: workflow_best_practice
tier: community
lesson_class: general
quality_tier: hand-vetted
context:
  tools:
    - supabase
    - claude-code
    - cursor
  languages:
    - sql
  platforms:
    - supabase
  tags:
    - dual-environment
    - debugging-hygiene
    - migrations
summary: >-
  When working with Supabase (or any DB tool with a local + remote variant),
  Studio screens for the two environments are visually indistinguishable.
  Asking the agent to "fix the SQL" without confirming which DB you mean leads
  to long debugging loops where the migration was applied to the wrong DB,
  the new table exists only locally, or the auth user is a different person
  with the same display name. Three-step environment check before any DB
  action.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The pattern

Before any DB-touching action — running migrations, inspecting tables,
writing to RPC, debugging "why is this row missing" — confirm three
things:

1. **Which database?** Read the project URL from the Supabase Studio
   address bar, or `echo $SUPABASE_URL`. Local is usually
   `http://127.0.0.1:54321`; cloud is `https://<ref>.supabase.co`.
2. **Which user?** `SELECT id, email FROM auth.users WHERE id = auth.uid();`
   Local and cloud have separate auth tables; the user with display name
   "Alex" in local is a different person than the user with the same
   name in cloud.
3. **Which app instance?** Check the Expo/Next.js dev-server logs or
   `.env.local` for the `SUPABASE_URL` it actually loaded. Multiple
   terminals running multiple ports against multiple DBs is the
   standard local-dev failure mode.

If any of these answers is "I'm not sure," stop and verify before the
SQL runs.

## Why the confusion is high-cost

Studio for local and cloud renders the same table list, same row counts,
same column layouts. There's no visual cue — no environment banner, no
distinguishing color scheme. The only differentiator is the URL in the
browser tab.

Concrete failure modes:

- **Migration applied locally, table doesn't exist in cloud.** Edge
  function deployed against cloud fails with `relation "foo" does not
  exist`. Hours of "but I just made that table" debugging.
- **Insert went to the wrong DB.** Row exists in local, the app reads
  from cloud, the user reports "your insert didn't work." Hours of
  RLS-policy debugging that goes nowhere.
- **Auth user mismatch.** Reset password for "alex@example.com" in
  local — cloud still has the old credentials. Login fails in the
  staging deploy.

## How to apply in agent-driven workflows

When the user pastes SQL or describes a "row is missing" problem, the
agent should **not** assume the environment is obvious. The fix is a
single clarifying question or — if the user has confirmed the
environment in the same message — a brief verbatim echo:

> "I'll run this against local (URL: 127.0.0.1:54321, user: alex@local).
> Confirm?"

This adds one sentence to the response and saves an hour of
wrong-environment debugging.

For migrations specifically, anchor the rule: **new tables exist only
where the migration ran**. A `supabase/migrations/<ts>.sql` file on
disk does not automatically apply to cloud. Either:

- Run `supabase db push --linked` against the cloud project, or
- Apply the migration manually via the cloud Studio's SQL editor.

Edge Functions deployed to cloud can only see cloud tables.
Mismatched expectations on this point are the second-most-common
local-vs-cloud failure after auth confusion.

## When this does not apply

If your project has a single environment (you only ever talk to cloud,
no local Supabase running), the check is over-investment. Default the
environment in your prompt and skip the recap.

The convention also does not apply to read-only inspection of clearly-
production data (a customer-support query against the prod URL). The
URL is unambiguous there; the three-step check is for the moments when
you're switching between environments multiple times per session.

## Verification

```bash
# Always-available environment recap script
env | grep -E '^(SUPABASE_URL|SUPABASE_ANON_KEY)' | sed 's/=.*/=<…>/'
psql "$DATABASE_URL" -c "SELECT current_database(), current_user, inet_server_addr();"
```

If `inet_server_addr()` returns `127.0.0.1` you're local; anything else
is remote. Keep this in your shell history as a one-liner — running it
costs nothing and answers all three questions.
