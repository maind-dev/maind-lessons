---
id: lsn_openvsx_namespace_similarity_publisher_rename
title: "Resolve your Open VSX namespace before the first publish — publisher renames are only free until then"
type: workflow_best_practice
summary: >-
  Open VSX refuses namespace names too close to existing ones ("too similar to existing
  namespace(s)"), which can force a publisher rename. The extension ID is
  `publisher.name` and neither gallery offers a rename, so that change is free only
  until the first publish — afterwards it is a new extension with an orphaned
  predecessor. Check availability with `GET /api/<ns>` (200 = taken); the
  `/api/-/namespace/<ns>` endpoint returns 404 even for namespaces that exist.
tier: community
context:
  tools:
    - vscode
  languages: []
  platforms:
    - open-vsx
    - vscode-marketplace
  tags:
    - vscode-extension
    - open-vsx
    - publishing
    - namespace
    - ovsx
---

## The rejection that starts this

Creating a namespace on open-vsx.org can fail with:

```
Namespace name 'maind' is too similar to existing namespace(s): Main, raind.
Please choose a more distinct name to avoid confusion.
```

The check is server-side and fuzzy — it fires on edit-distance-style closeness to
*any* existing namespace, including ones you have never heard of and cannot see in
search. There is no override; the name is simply unavailable to you. A review
request can be filed, but it is unbounded in time, so treating it as a blocker for
your release is a decision to stall indefinitely.

The practical answer is to pick a distinct name — and the cost of doing so depends
entirely on *when* you find out.

## Why the rename window closes at the first publish

A VS Code extension's identity is `publisher.name`, taken from the `publisher` field
in `package.json`. That identity is the primary key in both galleries and in every
place a user or script names your extension:

- `code --install-extension <publisher>.<name>`
- `.code-profile` files, which install extensions **by ID**
- `extensionPack` members in a bundle extension
- marketplace and Open VSX URLs

Neither gallery exposes a rename operation. The `ovsx` CLI's entire verb set is
`create-namespace`, `verify-pat`, `publish`, `get`, `check-license` — there is no
`rename`. Changing `publisher` therefore does not move an extension; it creates a
*different* one, leaving the old entry orphaned at its last version, with existing
installs pointed at an ID that no longer receives updates and users needing a manual
reinstall.

Before the first publish, the same change costs one field plus a grep for the ID.
That asymmetry is the whole point: **if you are going to be forced onto a different
namespace, you want to discover it before you publish, not after.** So resolve the
namespace *first*, then publish — not the other way round.

When you do rename, chase every occurrence, not just the manifest. A rename pass
filtered to `*.ts`/`*.md`/`*.json` will silently miss a `.code-profile` (which
installs by ID and then installs nothing) and any `.tsx` with a gallery link. Grep
without an extension filter and require zero hits.

## Checking availability — the endpoint that lies

The obvious-looking endpoint is not the one to use:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://open-vsx.org/api/-/namespace/redhat
# → 404   ...for a namespace that plainly exists

curl -s -o /dev/null -w "%{http_code}\n" https://open-vsx.org/api/redhat
# → 200   ← this is the reliable check
```

`GET /api/<ns>` returning 200 means taken, 404 means free. Checking the wrong
endpoint reports every name as available, including the ones that will later be
rejected as too similar — so the similarity rejection arrives as a surprise at
creation time rather than during planning.

Once created, a namespace reports:

```json
{"name":"your-ns","extensions":{},"verified":false,"access":"restricted"}
```

`verified: false` is **not** a blocker — it only means the ownership badge is absent.
`access: restricted` means only authorised members may publish, which is what you
want. Publishing works immediately.

## Tokens are scoped to the account, not the namespace

A personal access token created *before* the namespace existed still works for it.
Every `ovsx` call passes the token as a plain query parameter and the server resolves
authorisation from your account's namespace memberships at request time — nothing
about a namespace is baked into a token. The only reason to mint a new one is having
lost the value (Open VSX shows it once).

Confirm before spending the irreversible publish:

```bash
OVSX_PAT=<token> npx ovsx verify-pat <your-namespace>
```

`OVSX_PAT` is read automatically, which is why `ovsx publish` scripts usually carry
no `-p` flag. Two more preflight facts worth knowing, because both look like blockers
and are not: `vsce package` does **not** refuse a manifest marked `"private": true`,
and the Open VSX license gate passes as soon as the manifest has any `license` field
(`"SEE LICENSE IN LICENSE"` plus a LICENSE file is enough) — it only prompts when the
field is absent *and* no LICENSE file can be packaged.

## When this does NOT apply

- **Marketplace-only publishing.** The similarity check is Open VSX's; the VS Code
  Marketplace has its own publisher-ID rules. The rename-window argument still holds
  there, since the ID is equally immutable.
- **Already published.** Then the window is closed and this becomes a migration
  question, not a naming one: publish under the new ID, mark the old entry deprecated,
  and tell users to reinstall. Do not expect the transfer to be silent.
- **Internal / private galleries** with their own naming rules and no cross-publisher
  namespace collisions.

## Verification

```bash
# 1. is the namespace actually free?
for ns in cand-one cand-two; do
  printf "%-12s " "$ns"; curl -s -o /dev/null -w "%{http_code}\n" "https://open-vsx.org/api/$ns"
done   # 404 = free, 200 = taken

# 2. does the token cover it?
OVSX_PAT=<token> npx ovsx verify-pat <namespace>

# 3. after a rename: zero stragglers, no extension filter
grep -rn "oldpublisher\." . --include="*" | grep -v node_modules   # must be empty

# 4. the built VSIX really carries the new identity
unzip -p your-ext.vsix extension.vsixmanifest | grep -o 'Publisher="[^"]*"'
```

Related: [[lsn_adr_numbering_central_index]] — the same class of decision, where an
identifier becomes a public contract the moment anything references it, and is
therefore cheap to choose and expensive to change.

```
search_lessons({ query: "open vsx namespace too similar publisher rename extension id", platforms: ["open-vsx"] })
```
