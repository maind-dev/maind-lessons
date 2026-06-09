---
id: lsn_redaction_covers_id_and_edge_labels
title: Server-side redaction must strip slug-bearing ids and edge labels, not just preview fields
tier: community
type: workflow_best_practice
summary: When a server redacts content a caller is not entitled to (graph nodes, list rows, search hits), stripping the visible fields (title, summary, body) is not enough. Any field DERIVED from the content that still crosses the wire leaks it — most often the record/node id (if it embeds a slug or name) and relationship/edge labels (if they carry the raw reference text). Anonymise the id and strip labels on every edge touching a redacted node, server-side, before serialising.
context:
  tools: []
  languages:
    - typescript
    - sql
  platforms: []
  tags:
    - security
    - redaction
    - data-leak
    - access-control
    - graph
---

## The trap

Redaction usually starts correct: strip `title`, `summary`, `body` for any record the caller is not entitled to, server-side, before the payload leaves the process. Then it ships — and the hidden content is still readable, because two channels carry it that nobody thought to strip.

## Channel 1 — the id embeds the content

Stable ids are frequently built from the content: `org:<uuid>:doc:<slug>`, `user-42-secret-project`, `note_<filename>`. The slug/name IS the secret. A redacted node whose `id` is `…:doc_acme_layoff_plan` has leaked its title via the id alone — and the id is the one field you cannot simply null, because edges and keys reference it.

Fix: give redacted records an **opaque** id (`redacted:0`, a per-snapshot counter, or a non-reversible hash) and rewrite every reference to it. Better still, key the id on a non-content surrogate (a row uuid) from the start so the slug never enters the id in the first place.

## Channel 2 — edge/relationship labels carry the raw reference

In a graph, an edge often stores the raw reference text as its label: `{ source, target, label: "see acme_layoff_plan" }`. Even if both endpoint nodes are fully redacted, the edge label still spells out the hidden slug. The same applies to "X references Y" join rows, breadcrumb trails, and audit lines.

Fix: when either endpoint of an edge is redacted, drop the edge label (keep the edge itself — the topology/connection-count is usually intended to stay visible).

## The test that catches it

Serialise a redacted record and search the ENTIRE payload (not just the obvious fields) for the secret slug/title:

```
assert secret_slug not in json.dumps(node)        # id, type, href, …
assert all(secret_slug not in (e.label or "") for e in edges)
```

If the slug appears anywhere — id, label, a derived `href`, a `type` copied from frontmatter — redaction is incomplete.

## Boundary — when this does not apply

Redaction is "hide the content, keep the shape." If your design hides a record *entirely* (no placeholder, no edges), this does not apply — just omit it server-side. The id/label channels only matter when you deliberately render a *redacted placeholder* whose topology stays visible. And the rule is narrower than "strip everything": connection counts, orphan status, tags and group membership are typically meant to survive; strip only the fields from which the *content* (title/summary/slug) can be reconstructed.

## Cross-references

Pairs with the principle that redaction must be server-side, never client-hiding ([[lsn_rls_fails_for_caller_knows_secret]]), and with mirroring fields across a server/client wire boundary ([[lsn_edge_frontend_interface_mirror]]).
