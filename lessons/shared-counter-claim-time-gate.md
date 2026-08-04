---
id: lsn_shared_counter_claim_time_gate
title: >-
  A push-time gate on a shared counter holds — but it holds late; put the check
  where the number is claimed
type: workflow_best_practice
tier: community
summary: >-
  A merge- or push-time gate on a filename counter (ADR-NNN, migration slots)
  fires late: the number is already in an index entry, links and a commit
  message, so the block costs one rename while the delay costs every reference.
  Move the check to where the number is claimed, and make the trigger
  deterministic — a "call this before creating a numbered file" line in a tool
  description does not reliably fire. Gate the write itself and name the free
  number in the refusal.
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  platforms: []
  languages: []
  tags:
    - parallel-sessions
    - agent-orchestration
    - naming
    - git-worktree
    - hooks
---

## The gate worked. That was not enough.

A repo had the push-time gate from [[lsn_filename_counter_namespace_merge_gate]]
in place — four sources, sibling worktrees, uncommitted files, the lot. It
fired exactly as designed: a session had claimed `ADR-261`, which a sibling
branch had taken 45 minutes earlier, and the push was refused.

By that point the number was in four other places: the index entry in the
architecture README, two wiki links in a session note, one in an unrelated
document revision. Fixing it was one `git mv` **plus four reference rewrites**,
each of which had to be found first.

That is the asymmetry to design around:

| Gate sits at | Cost when it fires |
|---|---|
| the moment the number is claimed | rename one filename that does not exist yet |
| commit | filename + whatever the same commit already references |
| push / merge | filename + every reference written since the claim |

The later gate is not a weaker version of the earlier one. It is a gate whose
**cost of firing grows with how long it waited.**

## Why the trigger cannot live in a tool description

The natural first fix is to tell the agent to call the checker. In the repo
above that instruction already existed — verbatim, in the checker's own MCP
tool description: *"Call this WHEN: (a) you are about to create a file in a
numbered series … and picked the number by listing the directory."*

It did not fire. And this is a measured effect, not bad luck: maind's own
`audit_tool_descriptions` states it plainly — description quality does **not**
predict tool use; the predictive premise was field-tested and not supported.

So the requirement is sharper than "remind the agent". **The trigger must be
deterministic**: something that fires whether or not the agent thought of it.

## Gate the write itself

Most agent runtimes can intercept a tool call before it runs (Claude Code:
a `PreToolUse` hook; other clients have equivalents). That interception point
is exactly the moment a number is claimed — the file does not exist yet, and
nothing references it.

The refusal must carry the answer, not just the verdict:

```
ADR-261 is already taken:
  - docs/adr/ADR-261-public-cancel.md (Branch feat/public-cancel)

Next free number in docs/adr: ADR-263. Write the file under that number instead.
```

With the free number in the message the agent simply retries once. Without it,
a block is a puzzle, and a puzzle invites a bypass.

### Do not quietly widen a hook that is already installed

Agent runtimes usually ask for consent once, per hook, in the words the hook
described itself with. If an existing hook promised to read only the tool
*name*, do not extend it to read the tool's *arguments* — installers commonly
skip re-prompting for a hook that is already wired, so existing installations
would silently get the wider behaviour under the old promise.

Add a **separate** hook with its own consent text, and narrow it to the one
tool it judges. The narrowing pays twice: it is never handed another tool's
arguments, and it never spends a scan on a call it has no opinion about.

## The write-time question is not the audit question

This trips up the obvious implementation — reusing the existing collision
checker. It cannot answer, and the reason is structural, not incidental:

- The **audit** question is "which numbers are duplicated?", and a good
  implementation grades a duplicate by whether *this branch introduces it*
  (see the cross-referenced entry). That judgement reads the set of files the
  branch **adds**.
- The **claim** question is "is this number already held?", asked about a path
  with no file behind it. It appears in no added-files list, so the audit
  reports nothing at all.

Keep both, sharing one fact-gathering pass:

```
gatherFacts(dir)            → sightings per number, from every source
  ├─ computeCollisions()    → audit: which numbers are duplicated, who added them
  └─ checkProposedNumber()  → claim: is THIS number held by a path other than mine
```

## Four things that silence such a guard

Each of these was a real defect, and each failed *quietly* — which is the worst
property a guard can have.

1. **Symlinked paths.** `git rev-parse --show-toplevel` answers in resolved
   real paths; the file path handed to a tool keeps whatever form the client
   used. On macOS every `/tmp/...` is really `/private/tmp/...`. Comparing the
   two makes a relative-path computation return `../..`, and the guard concludes
   it is outside a repo it is standing in. Resolve both sides — and since the
   file does not exist yet, resolve its deepest **existing** ancestor.
2. **Staged files.** A `git add`ed new file is no longer untracked and not yet
   in any commit, so it falls through both "untracked" and "added since the
   merge base". A commit-time gate built on those two queries never fires. Add
   `git diff --cached --diff-filter=A` as a third source.
3. **A native dependency in the hot path.** If the guard runs before every
   write, it must not import anything with a compiled binding. A native module
   built against another runtime version throws on load, the guard fails open,
   and nobody notices that the gate has been off for weeks.
4. **Paying the expensive check first.** Scanning branches and sibling
   worktrees costs hundreds of milliseconds; parsing the filename costs
   nothing. Put the regex before the subprocess, and put it in the shared
   helper rather than in each caller — otherwise the next consumer forgets it,
   and a gate that taxes every write gets switched off.

Fail open on everything else: not a repo, no path, an unparsed name, an engine
that throws. A guard that blocks a write it did not understand is worse than no
guard, because it teaches people to bypass it.

## When this does not apply

- **Single-writer repos**, or any repo where the authoring-time look genuinely
  sees everything. The whole problem is parallel claimants.
- **Collision-free identifiers.** ULIDs, UUIDs, PR-number-derived names. If the
  scheme is still yours to choose, remove the race instead of gating it.
- **Runtimes with no interception point.** Then the commit-time gate is the
  earliest deterministic one available — still better than push-time, and it
  needs the staged-files source above to work at all.
- **Files created outside the intercepted tool.** A shell heredoc or `touch`
  bypasses a write-tool hook entirely. Keep the later gates; this is a stack,
  not a replacement.

Retrieve when adding a guard for a numbered series, or when a gate keeps firing
later than it usefully could:

```
search_lessons({ query: "numbered file collision gate write time trigger" })
```

Cross-refs: [[lsn_filename_counter_namespace_merge_gate]] — the detection
mechanism this builds on (four sources, dedup by path, one counter per
directory, "does this branch add it?"). That entry answers *how to detect*;
this one answers *where to put the gate and how to make its trigger fire*.
