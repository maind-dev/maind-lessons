---
id: lsn_multitenant_global_or_org_nullable_scope_partial_unique_rls
title: "Global-or-org content in one table: nullable `organization_id`, two partial unique indexes, and split SELECT policies"
type: workflow_best_practice
tier: community
context:
  tools: []
  languages: [sql]
  platforms: [postgres, supabase]
  tags: [postgres, multi-tenant, rls, partial-index, scoping, security-definer]
summary: "When the same resource exists at two scopes — global AND per-organization — model it in ONE table with a nullable `organization_id` (NULL = global). Enforce per-scope uniqueness with two partial unique indexes (`WHERE organization_id IS NULL` and `WHERE ... IS NOT NULL`). Reads split into two RLS SELECT policies (global-to-all + org-to-members); writes go through a SECURITY DEFINER RPC whose role gate branches on scope (global needs a curator, org needs an org-admin)."
last_validated_at: "2026-06-07"
---

## The shape

```sql
CREATE TABLE templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NULL REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = global
  created_by      uuid NULL REFERENCES users(id) ON DELETE SET NULL,        -- NULL = system seed
  slug            text NOT NULL,
  -- … payload …
  deleted_at      timestamptz NULL
);
```

`organization_id IS NULL` is the global tier; a set value is org-scoped. One
table, not two — readers and writers stay uniform.

## Uniqueness per scope: two partial unique indexes

A plain `UNIQUE(organization_id, slug)` treats every NULL org as distinct (so
two global rows can share a slug). Use **partial** unique indexes instead — they
also naturally exclude soft-deleted rows:

```sql
CREATE UNIQUE INDEX templates_global_slug ON templates (slug)
  WHERE organization_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX templates_org_slug ON templates (organization_id, slug)
  WHERE organization_id IS NOT NULL AND deleted_at IS NULL;
```

(Postgres 15+ also offers `UNIQUE NULLS NOT DISTINCT`, but the two partial
indexes are version-agnostic and give you the soft-delete filter for free.)

## Reads: two SELECT policies

```sql
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY templates_select_global ON templates FOR SELECT TO authenticated
  USING (organization_id IS NULL AND deleted_at IS NULL);

CREATE POLICY templates_select_org ON templates FOR SELECT TO authenticated
  USING (organization_id = current_user_org_id() AND deleted_at IS NULL);
```

Policies are OR-ed, so a member sees global rows + their own org's rows in one
`select *` — no client-side scope juggling.

## Writes: SECURITY DEFINER, scope-dependent gate

No write policies. A `SECURITY DEFINER` RPC decides the gate **by scope**:

```sql
IF p_org_id IS NULL THEN
  IF NOT is_curator(v_user) THEN RETURN '... global needs curator ...'; END IF;
ELSE
  IF NOT is_org_admin(p_org_id, v_user) THEN RETURN '... org needs admin ...'; END IF;
END IF;
```

The point: "who may write a global row" and "who may write an org row" are
different roles, and the single create-RPC branches on `p_org_id IS NULL`.

## When NOT to use this

If the two scopes diverge in columns or lifecycle, or global content is curated
through a completely different pipeline (e.g. a versioned repo), keep them
separate. This pattern fits when global and org rows are the *same shape* and
only differ in visibility + who may author them.

## Verification

- Two global rows with the same slug → rejected; an org row may reuse a global slug.
- Member of org A sees global + A's rows; never B's. A non-member sees only global.
- Non-curator cannot create a global row; non-admin cannot create an org row (RPC rejects, RLS shows nothing extra).