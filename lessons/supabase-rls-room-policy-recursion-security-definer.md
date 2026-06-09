---
id: lsn_supabase_rls_room_policy_recursion_security_definer
title: Fix Supabase RLS room/member policy recursion with a SECURITY DEFINER helper
type: debugging_lesson
tier: community
summary: Supabase/Postgres RLS policies that query the same RLS-protected participant table can recurse. Move membership checks into a narrow SECURITY DEFINER helper with a pinned search_path and explicit execute grants.
context:
  tools:
    - codex
  languages:
    - sql
  platforms:
    - supabase
    - postgres
  tags:
    - supabase
    - postgres
    - rls
    - security-definer
    - policies
    - debugging
languages:
  - sql
platforms:
  - supabase
  - postgres
tools:
  - codex
tags:
  - supabase
  - postgres
  - rls
  - security-definer
  - policies
  - debugging
routing_decision: public
source_context: ephemeral-idea
status: draft-needs-maind-preview
---

## Symptom

A room visibility smoke test fails when an authenticated participant tries to read their room:

```text
select room_sessions failed: infinite recursion detected in policy for relation "room_participants"
```

The schema shape is common in chat, collaboration, social, and realtime apps:

- `room_sessions` rows should be visible only to room members.
- `room_participants` rows should be visible to members of the same room.

The tempting RLS setup is:

```sql
create policy "room sessions visible to participants" on public.room_sessions
for select to authenticated using (
  exists (
    select 1
    from public.room_participants rp
    where rp.room_id = room_sessions.id
      and rp.user_id = (select auth.uid())
  )
);

create policy "room participants visible to room members" on public.room_participants
for select to authenticated using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.room_participants viewer
    where viewer.room_id = room_participants.room_id
      and viewer.user_id = (select auth.uid())
  )
);
```

The second policy queries the same table it protects. When the first policy also depends on that protected table, Postgres can recurse while trying to prove visibility.

## Fix

Move the membership check into a narrow `SECURITY DEFINER` helper and call that helper from the policies:

```sql
create or replace function public.is_room_participant(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_participants
    where room_id = p_room_id
      and user_id = p_user_id
  );
$$;

revoke all on function public.is_room_participant(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_room_participant(uuid, uuid) to authenticated;

create policy "room sessions visible to participants" on public.room_sessions
for select to authenticated using (
  public.is_room_participant(id, (select auth.uid()))
);

create policy "room participants visible to room members" on public.room_participants
for select to authenticated using (
  user_id = (select auth.uid())
  or public.is_room_participant(room_id, (select auth.uid()))
);
```

Use the same helper for adjacent participant-visible tables such as visible moderation events, messages, reactions, or room resources.

## Why this works

The helper centralizes the row-membership lookup and runs with the function owner's privileges. That avoids recursively applying the `room_participants` select policy to the helper's internal membership query.

Keep the helper narrow:

- Accept only the room ID and user ID needed for the policy.
- Return only a boolean.
- Set an explicit `search_path`.
- Revoke broad execution and grant only to roles that need the policy helper.

## Verification

Test both sides of the boundary:

1. Create two users and one room with both users as participants.
2. As participant A, select the room session and same-room participant rows.
3. As an outsider, select the same room session and expect zero rows.
4. Confirm the query does not fail with `infinite recursion detected in policy`.
5. Confirm service-role/admin queries still see the underlying rows for test assertions.

## When this does not apply

If a table's policy only checks its own ownership column, such as `user_id = auth.uid()`, no helper is needed. This pattern is for cross-row or same-table membership checks where a policy on one table must ask whether the caller has a row in another RLS-protected table, especially when that other table's policy also references itself.
