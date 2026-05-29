---
id: lsn_normalize_numbered_content_ids_keep_aliases
title: Normalize numbered content IDs without breaking references
type: workflow_best_practice
tier: community
context:
  tools: [codex]
  languages: [typescript]
  platforms: [mcp]
  tags: [content-migration, markdown, aliases, references, knowledge-graph]
summary: When migrating legacy Markdown content from `0001-title.md` or `lsn_0001_title` to slug-only names, normalize display IDs and graph aliases separately from storage paths. Keep legacy aliases resolving until all references and remote filenames are migrated.
problem: |
  A content graph displayed legacy lessons with numeric prefixes such as `0001-...` and `lsn_0001_...`, making published and local content look inconsistent. Removing the prefixes naively would have broken old wiki-style references, ID references, or edit links that still pointed at the actual remote filename.
solution: |
  Separate three concepts that are often collapsed into one string:

  1. Canonical content identity: the semantic ID the system should display and link semantically, for example `lsn_claude_md_structure`.
  2. Legacy aliases: old filenames, old ID forms, title-derived slugs, and underscore/dash variants that should still resolve references.
  3. Physical storage path: the exact file path that exists in the source repository right now.

  During migration:

  - Strip numeric prefixes for graph node IDs, labels, search aliases, and new canonical URLs.
  - Add both clean and legacy IDs to the alias map so `[[0001-title]]`, `lsn_0001_title`, and `lsn_title` can resolve to the same node.
  - Keep edit links for repository-backed content pointed at the real current file stem until the remote file is actually renamed.
  - Rename local template/sample files and update frontmatter IDs where the files are under local control.
  - Search for old references after the rename and update direct remediation IDs or documentation examples.

gotchas:
  - "Do not derive edit links only from the normalized ID while remote files still have legacy names. The UI will look clean but the editor route can 404."
  - "Do not delete legacy aliases immediately. Old Markdown references and generated docs can still use the numbered form."
  - "Normalize both `0001-title.md` and `lsn_0001_title`; filename and frontmatter migrations often drift independently."
  - "For published content in external repos, treat actual file renames as a separate remote migration with review, not a hidden side effect of graph rendering."
evidence: "Applied while cleaning a maind MCP content graph that needed to hide legacy `0001-` prefixes, preserve reference resolution, and keep edit links valid for repository-backed lessons."
last_validated_at: "2026-05-25"
---

## Implementation pattern

Use normalization at the graph/read layer and alias expansion at the reference-resolution layer:

```ts
function stripNumericIdPrefix(value: string): string {
  return value
    .replace(/^((?:lsn|tmpl|conv)_)\d{3,5}_/, "$1")
    .replace(/^\d{3,5}[_-]/, "");
}

function stripNumericPathPrefix(path: string): string {
  return path.replace(/(^|\/)\d{3,5}[_-]/g, "$1");
}
```

Then store aliases for both the raw and normalized forms:

```ts
const rawId = frontmatter.id ?? slugFromPath(path);
const cleanId = stripNumericIdPrefix(rawId);
const aliases = unique([
  ...aliasesFor(cleanId, path, title),
  ...aliasesFor(rawId, path, title),
]);
```

For UI labels, use the clean path or clean ID. For repository edit links, use the real file stem unless the remote file has already been renamed.

## Verification

1. Search the repo for `000[0-9]-` and `lsn_000[0-9]` references.
2. Confirm no local controlled `.md` filenames still use the numeric prefix.
3. Confirm graph display labels are clean.
4. Confirm old references still resolve to the same nodes.
5. Confirm edit links open the actual repository-backed file.

## When this does not apply

If the numeric prefix is part of a public stable identifier that external clients depend on, do not silently normalize it away. Add a formal deprecation window and expose both old and new identifiers in API responses until downstream consumers have migrated.