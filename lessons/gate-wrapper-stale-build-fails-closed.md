---
id: lsn_gate_wrapper_stale_build_fails_closed
title: "Fix a git hook that blocks every push with `TypeError: … is not a function` — a stale build must fail open"
type: debugging_lesson
tier: community
summary: "A CLI wrapper that imports a locally built package usually guards the MISSING build with try/catch around the import. A STALE build slips through: the import succeeds, the symbol is undefined, the call throws TypeError, and a pre-push hook or CI gate reads the non-zero exit as a policy violation — blocking every push. Guard both with one typeof check, because a fresh worktree has no build at all and any older build predates your newest export."
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  languages:
    - javascript
    - typescript
  tags:
    - git-hooks
    - ci
    - monorepo
    - fail-open
    - pre-push
    - build-artifacts
---

## Symptom

Every `git push` on the machine aborts. The output carries a stack trace
from a gate script you recently added, ending in
`TypeError: check is not a function` — and no mention of builds anywhere.

## The bug

A hook or gate shells out to a small wrapper that imports an engine from a
locally built workspace package:

```js
let check;
try {
  ({ check } = await import(new URL("../packages/engine/build/index.js", import.meta.url)));
} catch (err) {
  console.warn("⚠️  engine build not found — skipping the gate. Not blocking.");
  process.exit(0);                         // deliberate fail-OPEN
}
const report = await check(repoRoot);      // ← TypeError when the build is STALE
```

The author thought about the missing build and handled it. The **stale**
build is a different path: `build/index.js` exists but predates the new
export, so the import resolves, `check` is `undefined`, and the call throws.

The wrapper exits non-zero. A `pre-push` hook that does
`if ! node "$gate"; then block=1; fi` cannot tell a crash from a policy
violation — so it blocks. Every push stops, including work that never
touched the feature.

## Why it fires immediately, not rarely

- A **fresh worktree** (worktree-per-feature workflows, CI checkouts, a
  colleague's clone) has neither `node_modules` nor `build/`. That is the
  common case, not the edge case.
- Build output is normally gitignored, so **merging your gate does not ship
  its engine**. The very next checkout of the branch that introduced the
  gate is already in the failing state.
- Wired into a git hook, the blast radius is everyone on the machine.

## The fix: one predicate, both paths

Route both failures through the same loud-but-open exit:

```js
function bailOpen(reason) {
  console.warn(`⚠️  gate skipped: ${reason}\n    Build it with \`pnpm -F engine build\`. Not blocking.`);
  process.exit(0);
}

let check;
try {
  ({ check } = await import(new URL("../packages/engine/build/index.js", import.meta.url)));
} catch (err) {
  bailOpen(`build not found (${err instanceof Error ? err.message : String(err)})`);
}
if (typeof check !== "function") {
  bailOpen("build is stale (export missing)");
}
```

The rule behind it: **a gate must never fail closed on its own
infrastructure.** Failing closed on your own missing build is a worse trap
than whatever the gate was guarding — it is indistinguishable from a real
violation and it blocks unrelated work.

## Verify both branches before you ship it

Success messages prove nothing here — exercise the failure paths:

```bash
# 1. missing build
rm -rf packages/engine/build && node scripts/gate.mjs; echo "exit=$?"   # want 0 + warning

# 2. stale build (the one everybody forgets)
mkdir -p packages/engine/build
echo 'export const somethingElse = 1;' > packages/engine/build/index.js
node scripts/gate.mjs; echo "exit=$?"                                   # want 0 + warning
```

Two measurement traps while doing this:

- `cmd | tail; echo $?` reports **`tail`'s** exit code, not the command's.
  Redirect instead: `cmd >/dev/null 2>&1; echo $?`.
- If `core.hooksPath` is an absolute path (common in worktree setups), the
  hook that runs is the one in the *shared* checkout — your edited hook is
  not executed until it is merged. Exercise it by hand:
  `echo "refs/heads/x $(git rev-parse HEAD) refs/heads/x $(git rev-parse HEAD~1)" | bash .githooks/pre-push origin <url>`.

## When this does not apply

- **The gate ships its own logic** (single self-contained script, no import
  of a built artifact). There is no stale-build state to hit.
- **Runtime dependencies of the product itself.** A missing build there
  *should* fail loudly and closed — the fail-open rule is for
  guards/advisors, not for code whose absence means the product is broken.
- **Security-critical gates where absence must block by policy.** Then fail
  closed deliberately, but make the message say "checker unavailable", not
  "violation found" — and accept that you now own the checker's availability.
- **Published packages with a `prepare`/`prepublishOnly` build.** Consumers
  get a built artifact by construction; the stale case only bites local
  workspace consumers.

```
search_lessons({ query: "gate wrapper stale build fails closed pre-push blocked" })
```

Cross-refs: [[lsn_pnpm_workspace_prepare_script]] — the sibling problem on
the *consumer* side (a workspace package that ships an artifact needs a
`prepare` script, or hosts resolve an empty `build/`).
