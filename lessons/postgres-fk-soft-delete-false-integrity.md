---
id: lsn_postgres_fk_soft_delete_false_integrity
title: "Fix false-integrity foreign keys to soft-deleted rows — Postgres FKs can't be partial"
type: debugging_lesson
lesson_class: architecture
tier: community
summary: >-
  A Postgres foreign key is satisfied as long as the referenced row physically exists — it
  cannot carry a `WHERE deleted_at IS NULL` predicate (FKs can't be partial). So when the parent
  table soft-deletes, the FK guarantees nothing your reads rely on: code and RLS filtering
  `deleted_at IS NULL` silently drop the reference in joins while the constraint stays green.
  Fixes: a soft-delete trigger that reassigns children, hard-delete into an archive, or no FK
  plus a defined orphan fallback.
context:
  tools: []
  languages:
    - sql
  platforms:
    - postgres
    - supabase
  tags:
    - postgres
    - foreign-key
    - soft-delete
    - deleted-at
    - referential-integrity
    - schema-design
---

## The false-confidence pattern

Soft-delete (a `deleted_at timestamptz` column that every query filters on) and a foreign
key look like they compose. They don't, cleanly. A `REFERENCES parent(id)` constraint is
satisfied the instant the parent **row exists** — Postgres foreign keys have no predicate,
you cannot write `REFERENCES parent(id) WHERE deleted_at IS NULL`. So a child row pointing at
a *soft-deleted* parent is, to the database, perfectly valid.

Meanwhile every read path filters that parent out:

```sql
-- parent row 42 is soft-deleted:
UPDATE categories SET deleted_at = now() WHERE id = 42;

-- the FK on items.category_id -> categories.id is STILL satisfied:
SELECT 1 FROM items WHERE category_id = 42;            -- returns rows, constraint is green

-- but every real query / RLS hides the parent:
SELECT i.*, c.name
FROM items i
JOIN categories c
  ON c.id = i.category_id
 AND c.deleted_at IS NULL;                             -- the item's category VANISHES from the join
```

The constraint reported "integrity"; the application sees an item whose category silently
disappeared. You are back in the exact orphan / "Uncategorized" state the FK was supposed to
prevent — now with a false sense of safety *and* an extra constraint to carry.

The intuition that misfires is "FK ⇒ the reference is always resolvable" — which holds only
when deletes are *hard*. Soft-delete keeps the row, so the constraint stays green, but the row
is logically gone for everyone who honors `deleted_at`. The guarantee a foreign key actually
gives you (the row exists) is not the guarantee you wanted (the row is *live and visible*), and
Postgres cannot express that second one as a constraint at all — there is no partial /
conditional foreign key.

## Options, with trade-offs

1. **No FK — treat the column as a denormalized key (slug `text` or `id`).** Honest about the
   absence of DB-level integrity; the orphan case becomes a *defined* fallback
   ("Uncategorized" / "Other") instead of a surprise. Simplest, and correct when the reference
   is advisory (a category, tag, label).
2. **FK + a soft-delete trigger that nulls or reassigns children.** Real integrity, but you
   re-implement `ON DELETE SET NULL` / `CASCADE` by hand in a
   `BEFORE UPDATE ... WHEN (new.deleted_at IS NOT NULL)` trigger — the real `ON DELETE` clause
   never fires on a soft-delete, because no row is deleted. More moving parts to maintain.
3. **Hard-delete into an archive / audit table.** If integrity is the point, delete for real
   and move the row aside. Then `ON DELETE RESTRICT / SET NULL / CASCADE` does exactly what it
   says. This is the only option where the FK means what you think it means.

Pick (1) when the reference is advisory and orphans are tolerable; pick (3) when enforced
integrity is the actual requirement. (2) is the uncomfortable middle — choose it only when you
genuinely need soft-delete *and* enforced references on the same relationship.

## How to detect it in an existing schema

```sql
-- Referenced (parent) tables that ALSO carry a deleted_at column = the risk set.
SELECT DISTINCT confrelid::regclass AS referenced_table
FROM pg_constraint
WHERE contype = 'f'
  AND EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = confrelid
      AND a.attname = 'deleted_at'
      AND NOT a.attisdropped
  );
-- For each hit: is there a trigger handling children when the parent soft-deletes?
-- If not, every FK into that table is a false-integrity FK.
```

## When this does NOT apply

- **Hard-delete tables** — no `deleted_at`; the FK means exactly what it says, use it freely.
- **Soft-delete on the *child* only** — the trap is soft-delete on the **referenced** (parent)
  side. A row that soft-deletes itself is fine.
- **You genuinely want "points at a now-hidden row" semantics** — e.g. audit / history rows
  that should keep referencing the entity as it was. Then FK-to-soft-deleted is the feature,
  not the bug; just don't *also* assume a `deleted_at IS NULL` join will resolve it.

## Cross-references

- [[lsn_rls_fails_for_caller_knows_secret]] — sibling "the constraint doesn't mean what you
  think" trap, on the RLS side.
- [[lsn_defense_in_depth_rls_eq_filter]] — same instinct (don't lean on one layer for a
  guarantee it cannot make), applied to RLS plus explicit filters.

## Tool-use example for agents

When designing a table that soft-deletes, or adding an FK whose target carries a `deleted_at`:

```
search_lessons({
  query: "soft-delete foreign key deleted_at false integrity join",
  platforms: ["postgres"],
  tags: ["soft-delete", "foreign-key"]
})
```

Then `get_lesson({ id: "lsn_postgres_fk_soft_delete_false_integrity" })` for the full
options-and-trade-offs before locking in the constraint shape.
