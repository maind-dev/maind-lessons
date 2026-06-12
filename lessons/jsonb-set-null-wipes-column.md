---
id: lsn_jsonb_set_null_wipes_column
title: "NOT NULL violation from a JSONB setter: jsonb_set(col, path, NULL) returns NULL and wipes the whole column"
type: debugging_lesson
tier: community
summary: "Passing JS null to a PostgREST RPC with a jsonb parameter arrives as SQL NULL. jsonb_set(target, path, NULL, true) then returns NULL for the ENTIRE document, so a setter meant to clear one key nulls the whole JSONB column and trips its NOT NULL constraint. Clear keys by writing an invalid sentinel value, or guard the RPC with IF p_value IS NULL THEN target - key."
context:
  tools: []
  languages: [sql, typescript]
  platforms: [postgres, supabase]
  tags: [postgres, jsonb, jsonb-set, postgrest, not-null, supabase]
---

## Symptom

A `SECURITY DEFINER` setter RPC over a JSONB column (the classic `set_user_preference(p_key text, p_value jsonb)` doing an atomic `jsonb_set`) crashes with:

```
null value in column "preferences" of relation "users" violates not-null constraint
```

…but only when the caller tries to **clear** a key by passing `null`:

```ts
await supabase.rpc("set_user_preference", { p_key: "voice_key", p_value: null });
```

## Root cause (two NULL hops)

1. **JS `null` → SQL NULL.** supabase-js / PostgREST serialize JSON `null` for a `jsonb` parameter as SQL `NULL`, not as the jsonb scalar `'null'::jsonb`. There is no easy way to send `'null'::jsonb` through PostgREST — JSON null always maps to SQL NULL.
2. **`jsonb_set(target, path, NULL, true)` returns NULL.** `jsonb_set` is strict in its `new_value` argument: if `new_value` is SQL NULL the function returns NULL for the *whole* document — not "the key set to json-null". So:

```sql
UPDATE users
   SET preferences = jsonb_set(coalesce(preferences,'{}'::jsonb), '{voice_key}', p_value, true)
 WHERE id = auth.uid();
-- p_value = SQL NULL  ->  jsonb_set(...) = NULL  ->  preferences := NULL  ->  NOT NULL violation
```

The setter meant to touch one key nukes the entire column.

## Fix A — write an invalid sentinel (no migration)

If the column's readers already validate values, clear a key by writing a value that reads as "absent" rather than removing it:

```ts
// "" is not a valid catalog key -> resolution falls through to the default,
// exactly as an absent key would. jsonb_set gets a real jsonb value ('""').
await supabase.rpc("set_user_preference", { p_key: "voice_key", p_value: "" });
```

Works against the already-deployed RPC — no schema change.

## Fix B — make the RPC delete-on-null (cleaner, needs a migration)

Generalize the setter so `null` means "remove the key" via the `-` operator, which never returns NULL for a non-null target:

```sql
IF p_value IS NULL THEN
  UPDATE users SET preferences = coalesce(preferences,'{}'::jsonb) - p_key WHERE id = v_caller;
ELSE
  UPDATE users SET preferences = jsonb_set(coalesce(preferences,'{}'::jsonb), ARRAY[p_key], p_value, true) WHERE id = v_caller;
END IF;
```

## When this does NOT apply

- The column is **nullable** and you genuinely want to null it — then SQL NULL is the intended result, no trap.
- You pass a real jsonb scalar (`'null'::jsonb`, `'""'`, an object) — only SQL NULL triggers the whole-document wipe.
- You write the JSONB column directly from the client with a full object (not via `jsonb_set`) — different footgun; see `lsn_jsonb_concurrent_sync_lost_update`.

## Guardrails

- Don't rely on TypeScript: the RPC arg is typed `jsonb`/`Json` and `null` is a valid `Json`, so the type system won't warn.
- Keep the `NOT NULL` constraint on the JSONB column — it surfaces this loudly instead of silently emptying the column.
- The trap applies to `jsonb_set` anywhere `new_value` can be NULL, not just RPCs: wrap with `coalesce(new_value, 'null'::jsonb)` if a json-null is what you actually want.
- Related: `lsn_jsonb_concurrent_sync_lost_update` (why a single-path `jsonb_set` RPC is the right shape) and `lsn_postgres_function_overload_silent` (extend the setter body-only so Fix B doesn't create a silent overload). Find this from a session via `search_lessons({ query: "jsonb_set null not-null violation", platforms: ["postgres","supabase"] })`.
