---
id: lsn_jsonb_document_autosave_version_cas
title: "Autosave a whole-document JSONB column with optimistic version-CAS, not jsonb_set"
type: workflow_best_practice
tier: community
summary: "When one editing surface autosaves an ENTIRE JSONB document (a graph, a ProseMirror-style doc, a config blob), the lost-update fix is optimistic concurrency on a version column — UPDATE ... SET data=$new, version=version+1 WHERE id=$id AND version=$expected — NOT jsonb_set. jsonb_set is for patching independent sub-paths; for a whole-document replace it gives no concurrency protection. version-CAS detects the 2-tab/2-device overwrite and lets the UI reload."
context:
  languages: [sql, typescript]
  platforms: [postgres, supabase]
  tags: [jsonb, concurrency, optimistic-locking, lost-update, autosave]
---

## When this fires

You store a structured document as a single `jsonb` column (a node/edge
graph, a rich-text doc, a settings blob) and autosave the WHOLE column on
every change from one canvas/editor. Two tabs (or two devices) editing the
same row can silently overwrite each other — classic lost-update.

## Why jsonb_set is the wrong tool here

`jsonb_set(col, path, value)` patches ONE sub-path atomically. It is the
right fix when independent writers each own a different field of the same
JSONB — that is the field-level case in [[lsn_jsonb_concurrent_sync_lost_update]].
But a document editor replaces the **root** value wholesale — there is no
per-path ownership, so `jsonb_set` buys you nothing: the last full-document
write still wins.

## Fix: optimistic concurrency on a version column

Add an integer `version`. The client loads `{document, version}` and sends
the version it started from. The write is a compare-and-swap:

```sql
CREATE OR REPLACE FUNCTION save_document(p_id uuid, p_doc jsonb, p_expected_version int)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_new int;
BEGIN
  UPDATE documents
     SET document = p_doc, version = version + 1, updated_at = now()
   WHERE id = p_id AND version = p_expected_version
  RETURNING version INTO v_new;

  IF v_new IS NULL THEN
    -- 0 rows updated: someone else bumped the version since we loaded.
    RETURN jsonb_build_object('ok', false, 'error', 'version_conflict',
      'current_version', (SELECT version FROM documents WHERE id = p_id));
  END IF;
  RETURN jsonb_build_object('ok', true, 'version', v_new);
END $$;
```

Client: keep the last confirmed version in a **ref**, not state, so your
own success-bump does not re-trigger the autosave effect. On
`version_conflict`, surface a "reload to get the latest" banner instead of
clobbering.

## Validate the document shape server-side

Since you replace the whole value, validate it in the RPC:
`jsonb_typeof(p_doc) = 'object'`, required array fields present, and a size
cap (`pg_column_size(p_doc) > 1MiB → reject`) — a huge JSONB built/returned
in the hot path is its own problem (see [[lsn_postgres_jsonb_rpc_timeout]]).

## When this does NOT apply

- **Independent field writers** (one hook per preference field) → that IS
  the `jsonb_set` case; per-path atomic update is correct there.
- **Real-time collaborative editing** (multiple cursors in the same doc) →
  you need CRDT/OT, not last-write-CAS; CAS only detects the conflict, it
  does not merge.
- **Append-only logs** → append via `||` or a child table, not full replace.

## Related

```
search_lessons({ query: "jsonb lost update concurrency autosave version", platforms: ["postgres", "supabase"] })
```
