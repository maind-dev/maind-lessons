---
id: lsn_audit_trigger_explicit_column_list_omits_new_columns
title: "Fix an audit trigger that silently omits every column added after it was written"
type: debugging_lesson
tier: community
summary: "A row-audit trigger that INSERTs an explicit column list keeps compiling and keeps firing after you add a column to the audited table — it just never records the new column. Nothing fails, and the gap only surfaces months later when someone asks a history question the audit cannot answer. Extend the trigger in the SAME migration that adds the column, or write the trigger against a whole-row snapshot so it cannot drift."
context:
  languages:
    - sql
  platforms:
    - postgres
    - supabase
  tags:
    - postgres
    - triggers
    - audit-trail
    - schema-evolution
    - silent-gap
---

## The shape of the trap

The common row-audit trigger enumerates its columns:

```sql
CREATE FUNCTION thing_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO thing_revision(thing_id, op, title, status, changed_by)
  VALUES (new.id, tg_op, new.title, new.status, auth.uid());
  RETURN new;
END $$;
```

Months later you add two columns to `thing` — say `starts_on` and `target_on`.
The trigger still compiles. It still fires on every write. It still writes a
revision row. **It just never records the two new columns**, and neither does
`thing_revision`, which has no place to put them.

There is no error, no warning, no failing test. The audit table keeps growing
and looks healthy.

## Why it is worth naming

The damage is not that a write fails — it is that a **question becomes
unanswerable, retroactively and permanently**. "How often was this date moved?"
/ "who changed the owner, and when?" / "what did this row look like before the
incident?" are answerable only from data captured at the time. A column added
in January and audited from June has a five-month hole that no later fix can
backfill.

The failure is also *load-bearing in the wrong direction*: teams write design
docs saying "we do not need a history table, the audit trail already covers
this" — true for the columns that existed when the trigger was written, false
for every column added afterwards. The claim ages into a lie without anyone
editing it.

## Detection

Compare what the audited table has against what the audit table can hold:

```sql
SELECT a.attname AS missing_in_audit
  FROM pg_attribute a
 WHERE a.attrelid = 'public.thing'::regclass
   AND a.attnum > 0 AND NOT a.attisdropped
   AND a.attname NOT IN ('created_at', 'updated_at')          -- taste
   AND NOT EXISTS (
         SELECT 1 FROM pg_attribute b
          WHERE b.attrelid = 'public.thing_revision'::regclass
            AND b.attname = a.attname
            AND b.attnum > 0 AND NOT b.attisdropped);
```

A non-empty result is the gap. Run it whenever you touch a table that has an
audit trigger — it costs nothing and it is the only signal you will get.

## Two fixes

**A — extend both, in the same migration.** The boring one. The point is the
*same migration*: an audit extension deferred to "a follow-up" is the follow-up
that never happens.

```sql
ALTER TABLE thing_revision
  ADD COLUMN IF NOT EXISTS starts_on date,
  ADD COLUMN IF NOT EXISTS target_on date;

CREATE OR REPLACE FUNCTION thing_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO thing_revision(thing_id, op, title, status, changed_by, starts_on, target_on)
  VALUES (new.id, tg_op, new.title, new.status, auth.uid(), new.starts_on, new.target_on);
  RETURN new;
END $$;
```

**B — snapshot the row so it cannot drift.** If the audit is for forensics
rather than for typed queries, store the whole row and stop maintaining a
parallel column list:

```sql
-- to_jsonb(new) picks up columns added later, automatically:
INSERT INTO thing_revision(thing_id, op, row_data, changed_by)
VALUES (new.id, tg_op, to_jsonb(new), auth.uid());
```

Trade-offs, honestly: `jsonb` snapshots are larger, cannot be constrained or
indexed per field without extra work, and will happily capture a column you
later regret storing (secrets, tokens, personal data — a column list is a
privacy *allowlist*, and that is its one real virtue). Choose B when the audit
must never drift; choose A when the audit is a typed, queried surface and you
accept the maintenance.

## When this does NOT apply

- **Logical-replication / CDC-based audit** (`wal2json`, Debezium, Supabase
  Realtime): the stream carries whatever the row has, so new columns appear
  without changes.
- **`to_jsonb(new)`-style triggers already** — the drift is structurally
  impossible.
- **Deliberately narrow audits.** Recording only `status` transitions is a
  legitimate design. It stops being legitimate when someone later cites the
  audit as covering more than it does — so write the intent into a
  `COMMENT ON TABLE`, not just into a migration nobody re-reads.

## Cross-references and retrieval

Before adding a column to a table that has an audit trigger:

```
search_lessons({
  query: "audit trigger explicit column list new column missing history",
  platforms: ["postgres"],
  tags: ["audit-trail"]
})
```

Then `get_lesson({ id: "lsn_audit_trigger_explicit_column_list_omits_new_columns" })`
for the detection query and the two fixes.

- [[lsn_postgres_trigger_silent_default_masks_bug]] — sibling failure on the
  same surface: a BEFORE-INSERT trigger silently *substituting* a value instead
  of an audit trigger silently *omitting* one.
- [[lsn_postgres_fk_soft_delete_false_integrity]] — same family: a database
  guarantee that quietly stops meaning what the design doc claims.
