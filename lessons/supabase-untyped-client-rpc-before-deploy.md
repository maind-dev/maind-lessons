---
id: lsn_supabase_untyped_client_rpc_before_deploy
title: "Untyped Supabase client: ship an RPC's consumer before its migration, trading away RPC type-safety"
type: workflow_best_practice
tier: community
summary: "A Supabase client created without the <Database> generic accepts any string as an .rpc() name. That lets a new RPC's consumer compile and ship in the same PR as its migration, before db push / type regen — and degrade gracefully via .error until the function exists. The trade-off is real: you lose compile-time checking of RPC names, args, and return shapes at every call site, not just the new one."
context:
  tools: []
  languages: ["typescript"]
  platforms: ["supabase"]
  tags: ["supabase", "type-safety", "rpc", "migrations", "deployment-ordering"]
---

`createClient(url, key)` / `createServerClient(url, key, ...)` *without* the `<Database>` generic returns a loosely-typed client: `supabase.rpc("any_name", anyArgs)` compiles and `.data` comes back effectively `any`. Common in quick SSR setups that never wired up generated types.

## The useful consequence

Because the RPC name is not checked against generated types, you can **ship the consumer of a not-yet-deployed RPC in the same PR as its migration**. `typecheck` and `build` stay green before `supabase db push`. At runtime, until the function exists, the call returns a PostgREST `.error` (function not found) — so a guarded consumer degrades gracefully:

```ts
const res = await supabase.rpc("get_usage_time_grid", { p_days: 28 });
const grid = res.error ? null : (res.data as unknown as UsageTimeGrid);
// render nothing (or a fallback) while grid is null — no page blank, no crash
{grid ? <Punchcard grid={grid} /> : null}
```

The migration and its consumer travel together; the feature "lights up" once the migration is pushed.

## The trade-off (do not skip this)

An untyped client removes RPC name / argument / return-shape checking from **every** call site, not just the new one — typos and shape-drift become runtime bugs instead of compile errors. This is the inverse of the usual advice. Prefer one of:

- **Type the client** (`createServerClient<Database>(...)`), and to still ship consumer-before-deploy, hand-add the new function to `database.types.ts` before regenerating — the same manual-add escape hatch as [[lsn_supabase_gen_types_local_loses_cloud_rpcs]].
- If the client is *already* untyped project-wide, this ordering is a genuine convenience — but treat it as a reason to add a typed wrapper for critical RPCs, not as an endorsement of staying untyped.

## When this does NOT apply

- Typed client and you are unwilling to hand-edit generated types → push the migration and regen first, then add the consumer (the migration is the dependency).
- The consumer must NOT silently no-op when the RPC is missing (e.g. a critical write path) → fail loudly instead of degrading to `null`.

## Related

- [[lsn_supabase_gen_types_local_loses_cloud_rpcs]] — the manual type-add escape hatch for a typed client.
- [[lsn_edge_frontend_interface_mirror]] — `.data as unknown as T` is an unchecked wire cast; mirror the shape deliberately.

Discover neighbours: `search_lessons({ query: "supabase rpc generated types migration ordering", platforms: ["supabase"] })`.
