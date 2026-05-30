---
id: lsn_solo_dev_parallel_agent_state_drift
title: "Solo dev with multiple AI-agent sessions: treat your own past sessions as parallel collaborators"
type: workflow_best_practice
tier: community
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: []
  tags: [parallel-sessions, solo-developer, ai-agent-workflows, session-hygiene, state-drift]
summary: "Solo developers running multiple AI-agent sessions (Claude Code, Cursor, Windsurf) over hours or days accumulate state-drift: orphan branches, uncommitted WIP, release commits without push, modified config files. The user often doesn't remember what a 5h-old session did. Treat your own past sessions as parallel collaborators — run a session-start mini-audit (`git status -sb` + `git reflog | head -10` + `git stash list`) before assuming a clean slate."
problem: |
  The existing curated convention [[lsn_parallel_sessions_first_ask]]
  frames "unexpected repo state" as a team-collaboration signal — work
  by colleagues, parallel sessions of other developers. The first-ask
  reflex is calibrated for "this isn't mine, don't destroy it."

  But solo developers running AI-agent sessions hit the same failure
  mode with a different cause: their own past sessions, hours or days
  earlier, left state behind that the current session has no in-context
  memory of. The user themselves doesn't remember either, because the
  earlier session happened in a different mental context (a different
  feature, a different time of day, a different mood).

  Examples observed in practice:

  - A topic branch `test/feature-x` created 5h ago by an experiment
    the user has since forgotten about
  - A `git stash` entry with an unhelpful default name from a session
    that was interrupted
  - A release commit on a branch never pushed, because the session
    ended before the push step
  - A modified config file from a session that was supposed to "just
    look something up" but ended up making local changes

  Each of these reads to the next session as "unfamiliar state of
  unknown origin" — exactly the same signature as team-collaboration
  state. The same first-ask reflex should apply, but the user can
  often answer "oh, that was me yesterday" instantly when shown the
  evidence. The cost is asking; the cost of NOT asking is destroyed
  WIP.
solution: |
  Add two practices on top of the existing parallel-sessions
  first-ask reflex:

  **Session-start mini-audit** — even for solo dev:

  ```bash
  # 1. Current state
  git status -sb

  # 2. Recent HEAD movements (who/what/when of the last actions)
  git reflog --date=iso | head -10

  # 3. Forgotten stashes
  git stash list

  # 4. Orphan branches (local-only, no upstream)
  git for-each-ref --format='%(refname:short) %(upstream:short)' refs/heads/ \
    | awk '$2 == "" {print "orphan: " $1}'
  ```

  These four commands take under a second and surface most of what
  could be "past-me state." If the output is empty / clean: proceed.
  If something is there: ask the user about it before any cleanup,
  same as the team-collaboration case — but expect the user to
  recognize their own work in 70% of cases and dismiss it quickly.

  **Self-collaboration mental model** — when narrating unexpected
  state to the user:

  > "I see state that may not be from this session:
  > - Branch `test/feature-x` (created 5h ago, 1 unique commit)
  > - Stash with message 'wip: <empty>'
  > - Modified `package.json` (version bump)
  >
  > Possible sources: a previous session of mine, your manual work
  > between sessions, or genuine WIP I should preserve. What's the
  > story here?"

  The phrasing "possible sources: a previous session of mine" makes
  the self-collaboration explicit. Users often respond with
  recognition ("oh yeah, that was my Tuesday session") and a clear
  instruction ("leave it" or "wrap it up and commit").
gotchas:
  - "The session-start mini-audit is cheap (< 1 second) but easy to skip when the user opens a fresh session and starts dictating tasks. Build it into your standard intro routine — even if 95% of audits show clean state, the 5% that don't would otherwise destroy WIP."
  - "Reflog retention is 90 days for reachable commits and 30 days for unreachable. A session-start audit from 60+ days later may miss the relevant entry. For long-gap context recovery, also check `git fsck --lost-found`."
  - "Solo-dev workflows tend toward less-aggressive branch hygiene — orphan branches and unpushed commits accumulate faster than in team contexts where push-on-end discipline is enforced. Treat this as known shape, not anti-pattern."
  - "The first-ask reflex from the existing parallel-sessions convention assumes the user can answer 'this is mine, don't touch it.' Solo devs may not remember instantly — give them the reflog timestamps and branch names so they can reconstruct the context."
  - "If the user IS using parallel Claude Code / Cursor sessions concurrently (not just sequentially), the unexpected state can be live from another window. Default to ask before any cleanup — destroying live concurrent-session state is the worst failure mode here."
last_validated_at: "2026-05-28"
---

## Why this convention exists alongside the existing one

[[lsn_parallel_sessions_first_ask]] frames unexpected state as team-
collaboration signal. This convention is the solo-dev variant: state
left by the user's own past sessions, which feels identical to
team-collaboration state but has different recognition patterns.

The two compose. A session-start audit handles both:

- State you yourself created (this convention): the user recognizes
  it from a timestamp, branch name, or commit message
- State a collaborator created (the team convention): the user
  recognizes it as "not mine, leave it" or "not mine, check with X"

Either way the answer is "ask before destroying" — but the dialogue
shape differs.

## The mini-audit recipe

```bash
# 1. Current modifications + branch
git status -sb

# 2. Recent HEAD movements
git reflog --date=iso | head -10

# 3. Forgotten stashes
git stash list

# 4. Orphan branches (no upstream)
git for-each-ref --format='%(refname:short) %(upstream:short)' refs/heads/ \
  | awk '$2 == "" {print "orphan: " $1}'
```

Run all four at session-start when picking up an existing repo. Total
time: well under a second. If output is fully clean, proceed without
narrating. If anything appears: surface it to the user with the
self-collaboration framing.

## Common signatures of "past me did this"

| Signature | Likely past-me cause |
|---|---|
| Branch with `test/`, `wip/`, `experiment/` prefix and recent timestamp | Experiment or quick test the user forgot to clean up |
| Unpushed release commit on a branch (`chore(release): ...`) | Release session interrupted before the push step |
| Modified config file (`package.json`, `tsconfig.json`) | Look-up session that turned into a tweak |
| Stash with empty or default message | Interrupted session — user stashed and walked away |
| Many small "wip" commits over hours | Iterative session-of-sessions building up |

When you see one of these, do NOT just clean it up. Surface it. The
user usually recognizes their own pattern instantly.

## When this does NOT apply

- **Truly fresh repos** where the user just ran `git clone` or `git init` — there is no past-me state to surface. Skip the audit.
- **Strict team contexts with mandatory push-on-end discipline** — state-drift can't accumulate because the discipline enforces clean state. The team-collaboration convention is sufficient.
- **CI / automation environments** — these run in fresh checkouts every time. No solo-dev drift to detect.

## Recovery references

When the audit surfaces an orphan branch with unique commits, the
recovery recipe is the orphan-branch-recovery convention (find it via
`search_lessons({ query: "orphan local branch recovery ff-merge" })`).
For the stash-pattern that preserves working-tree state across the
recovery, search for the `git stash push -u` convention. For deeper
reflog forensics, search for the reflog-as-forensics convention.

## Discovering related conventions

```typescript
// The team-collaboration variant this convention extends:
get_lesson({ id: "lsn_parallel_sessions_first_ask" });

// The recovery recipe when the audit surfaces an orphan branch:
search_lessons({ query: "orphan branch recovery", tools: ["git"] });

// The diagnostic tool for "where did this branch come from":
search_lessons({ query: "git reflog forensics" });
```