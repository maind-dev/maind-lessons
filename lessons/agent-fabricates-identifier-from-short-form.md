---
id: lsn_agent_fabricates_identifier_from_short_form
title: "Never complete an identifier from a short form — a full SHA, UUID or digest is a lookup, not a derivation"
type: workflow_best_practice
tier: community
summary: >
  An agent holding a short SHA and asked for the full 40 characters fills in the rest.
  It does not feel like inventing: the prefix is real and was read from actual output,
  only the tail is fabricated. The result passes every format check and is stored
  unresolved by event logs and audit records. The rule is mechanical — a field wanting a
  complete identifier is a lookup, always, even when the abbreviated form is in context.
context:
  tools: [claude-code, cursor, windsurf, copilot, codex]
  languages: [bash]
  platforms: [git, github]
  tags: [agent-safety, identifiers, git, hallucination, provenance, verification]
---

## The failure mode

An agent has been working with a commit for several turns. The short SHA appears
repeatedly in its context — in `git log --oneline` output, in a PR listing, in its own
earlier message:

```
fb5de6af feat(planning): agent path — post_update/post_comment
```

Then a field asks for the full hash: an event-log call with `commit_sha`, an
attestation record, a release note, a `git show` in a follow-up command. The agent
writes forty hex characters beginning `fb5de6af`. The first eight are correct. The
remaining thirty-two are invented.

Every downstream check that could plausibly exist still passes. It matches
`^[a-f0-9]{40}$`. It has the right length and alphabet. It carries a prefix that
genuinely resolves in the repository. What it does not do is name a commit.

## Why it does not feel like fabrication

This is the part worth internalising, because it explains why knowing about the
failure does not prevent it.

Ordinary hallucination has a recognisable texture: you reach for something not in
context and feel the reach. Here, nothing is reached for. **The prefix is real, it was
read from actual output, and it is sitting in context.** The operation feels like
*formatting* — like padding a number or expanding an abbreviation — rather than like
producing a fact. There is no moment of invention to catch, because subjectively there
isn't one.

The tail is not even random. It is drawn from the distribution of plausible hex, which
is exactly what makes it survive review: nobody reading `fb5de6af9c2d1e...` sees
anything wrong, and no linter disagrees.

Two structural properties finish the job:

- **Hashes are not error-detecting.** A SHA carries no checksum over itself. Unlike a
  malformed URL or a syntax error, a wrong hash is indistinguishable from a right one
  without resolving it.
- **Many sinks never resolve.** Event logs, audit tables, changelogs and attestation
  records typically store a hash as an opaque string. The write succeeds. The record is
  now permanently, invisibly wrong — and it is exactly the class of record whose entire
  value is being trustworthy later.

### And why it recurs after you have admitted it

Observed directly: an agent fabricated a SHA, disclosed it, stated the rule
explicitly — and did it again two steps later on the next PR, in the same session.

The reason is a mismatch in what persists. The *commitment* is a sentence in the
transcript, competing with everything else for attention. The *habit* is a reflex at the
moment a field needs filling, and it fires under exactly the conditions that make
reflexes win: near the end of a long task, in a step that feels administrative, when the
alternative is interrupting the flow with a shell call for something you "already know".

An intention formed in turn 40 does not reliably reach turn 47. **The countermeasure has
to sit at the point of use, not in memory:** a rule attached to the *shape of the field*
rather than to a resolution to be careful.

## The rule

> If a field wants a complete identifier and what you have is an abbreviated one, you do
> not have it. Look it up.

Deliberately mechanical, with no judgement call in the middle — anything requiring an
assessment of "do I actually know this?" fails, because the whole problem is that it
feels known.

Applies to every identifier that is assigned rather than derived:

| Identifier | Resolve with |
|---|---|
| Full commit SHA from a short form | `git rev-parse --verify <short>^{commit}` |
| SHA of current HEAD | `git rev-parse HEAD` |
| Merge commit of a PR | `gh pr view <n> --json mergeCommit --jq .mergeCommit.oid` |
| Tag → commit | `git rev-list -n 1 <tag>` |
| UUID of a record | query the system that issued it — never reconstruct from a prefix |
| Container image digest | `docker inspect --format='{{index .RepoDigests 0}}' <image>` |
| Published package version | `npm view <pkg> version` |

The same reflex reaches UUIDs, and there it is more common than with hashes, because a
UUID's dashes make the first block feel like the whole name. `07b2b422-...` is a prefix,
not an identity.

## Detection

**Before writing.** One question at the field: *did I read these exact characters, or am
I producing them?* If the abbreviated form is what you saw, the long form is not yours to
write.

**In review.** Two tells worth knowing:

- A full SHA whose **first 7-8 characters appear elsewhere in the same document** while
  the tail appears nowhere. Genuine full hashes are usually copied from a command whose
  output is also present.
- A hash in **prose** — a commit message body, a PR description, a design document. Tool
  arguments sometimes get validated; prose never does, so fabrication concentrates there.

**Verify a suspect one directly** — this is cheap and definitive:

```bash
git rev-parse --verify --quiet <sha>^{commit} || echo "does not resolve"
```

Note what the failure means. A hash that does not resolve is *unknown*, not necessarily
invented — it may belong to another repository, or to a commit not fetched locally. Do
not upgrade "unknown" to "fabricated" without knowing the repository is the right one.
The reverse inference is the sound one: **a prefix that resolves while the full string
does not is proof of fabrication**, because a real commit with that prefix exists and it
is not the one named.

### Structural mitigation, and its limits

Where an agent's tool calls pass through a wrapper you control (an MCP gateway, a proxy,
a hook), the check can be made automatic: intercept arguments whose names indicate a
hash, resolve each against the local repository, and warn or deny on the
prefix-resolves-but-full-string-does-not case. Cheap, deterministic, no model involved.

Be clear about what that does **not** reach, or the mitigation breeds false confidence:

- **Prose.** A SHA in a commit body or PR description is not a tool argument.
- **Other identifier types.** A gateway keyed on hash-shaped fields sees nothing when a
  UUID is reconstructed.
- **Every agent without that wrapper** — which is most of them, most of the time.

So the interception is a backstop for one path. The rule above is the actual defence,
and it is the only part that travels.

## When this does NOT apply

- **You read the full identifier this session** and are reusing it. Copying is fine; the
  prohibition is on *completing*.
- **Short forms where a short form is wanted.** `git log --oneline` output, prose that
  references `fb5de6af` as an abbreviation, a table of recent commits. Git resolves
  unambiguous prefixes itself — the problem is only ever padding a prefix to full length.
- **The identifier is genuinely derived, not assigned.** A content hash you compute, a
  slug you generate from a title, a path you construct from known parts. Those follow
  from inputs you hold; a commit SHA does not.
- **Placeholders that are marked as such.** `<sha>`, `abc1234`, `0000...` in
  documentation and examples are explicitly not claims about a real object.

## Related

```
search_lessons({ query: "agent identifier fabrication commit sha uuid lookup verification" })
```

- [[lsn_self_authored_agent_doc_routing]] — the other family of failure where an agent's
  own convenience habit quietly degrades an artifact meant to be trusted later.