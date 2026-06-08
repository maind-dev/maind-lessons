---
id: lsn_postgres_scoped_quota_coalesce_zero_and_lifecycle_subset
title: "Diagnose a `0/0 used` quota deadlock from `COALESCE(missing_limit, 0)` — and counting the wrong lifecycle subset"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [sql, typescript]
  platforms: [postgres, supabase]
  tags: [postgres, quota, plan-limits, rls, saas, security-definer]
summary: "A per-plan quota in a SECURITY DEFINER RPC has two silent failure modes. (1) If the limit was never seeded, `COALESCE(features->>'max_x', 0) = 0` makes the gate `count >= 0` always true → every create is rejected even at zero usage (the '0/0' deadlock). (2) Counting the wrong lifecycle subset (all non-deleted vs only active) penalizes experimentation. Fix: add a 'feature-on ⟹ limit > 0' invariant, count the subset matching the limit's name, and gate the transition that consumes quota."
last_validated_at: "2026-06-07"
---

## Failure mode 1 — the COALESCE(NULL, 0) deadlock

A typical quota gate inside a `SECURITY DEFINER` create-RPC:

```sql
v_limit := COALESCE((pd.features->>'max_widgets')::int, 0);  -- <-- trap
IF v_limit >= 0 THEN
  SELECT count(*) INTO v_used FROM widgets WHERE owner = v_user AND deleted_at IS NULL;
  IF v_used >= v_limit THEN
    RETURN jsonb_build_object('ok', false, 'error', 'quota_reached');
  END IF;
END IF;
```

If the plan row exists but `max_widgets` was **never seeded**, `->> ` returns
NULL → `COALESCE(…, 0) = 0` → `0 >= 0` is true → **every** create is rejected,
including the very first one. The UI shows "0 / 0 used" and the user cannot
create anything, even though they're entitled. The feature looks broken, not
quota-limited.

**Fixes, layered:**

- **Backfill the limits** and add the invariant *feature-enabled ⟹ limit > 0*:

  ```sql
  UPDATE plan_definitions
     SET features = jsonb_set(features, '{max_widgets}', '10')
   WHERE COALESCE((features->>'feature_enabled')::boolean, false)
     AND COALESCE((features->>'max_widgets')::int, 0) = 0;
  ```

- Decide what a **missing** limit means deliberately. `0` = "blocked"; if you
  mean "unset → generous default", COALESCE to that default, not to 0. Use a
  sentinel like `-1` for "unlimited" and branch on it (`IF v_limit >= 0`).

## Failure mode 2 — counting the wrong lifecycle subset

A column named **`max_active_widgets`** that actually counts *all non-deleted*
rows (draft + active + archived) is a misnomer with real consequences:

- Trying out drafts / templates **consumes the quota** → users hit the wall while
  experimenting, not while shipping.
- Archived items count too → archiving isn't a way to free a slot; only deleting is.

Count the subset that matches the limit's meaning. If the limit is on
*published/active* resources, enforce it on the **transition to active**, not on
create — and let drafts be free:

```sql
-- in set_status(p_id, 'active'):
IF p_status = 'active' AND v_current_status <> 'active' THEN
  SELECT count(*) INTO v_active
    FROM widgets WHERE owner = v_owner AND status = 'active' AND deleted_at IS NULL;
  IF v_active >= v_limit THEN RETURN '... quota_reached ...'; END IF;
END IF;
```

Watch the **enforcement-point shift**: if you move the count to "active", then
*create* no longer consumes quota and the gate belongs on the activate path
(and on any other RPC that can set the row active). Enforcing only at create
becomes meaningless once create no longer changes the counted set.

## Surface the numbers

The RPC usually returns `limit` and `active` in its error payload — don't let the
UI swallow them. Showing "N / N active used" turns a mysterious "limit reached"
into an actionable message, and would have made failure mode 1 obvious instantly.

## Verification

- New account on a paid plan, zero rows: first create must succeed (catches the COALESCE deadlock).
- Create the limit+1-th *counted* resource → blocked with the real numbers; create an *uncounted* one (e.g. a draft) → allowed.
- Downgrade leaves existing over-limit rows alone (only the transition is gated) — decide if that's acceptable.