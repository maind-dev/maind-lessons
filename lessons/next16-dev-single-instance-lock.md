---
id: lsn_next16_dev_single_instance_lock
title: "Fix 'Run kill <pid> to stop it' — Next.js 16 dev refuses a second instance per app directory"
type: debugging_lesson
tier: community
context:
  tools: []
  languages: [typescript]
  platforms: [nextjs]
  tags: [nextjs, next-dev, dev-server, parallel-sessions, ports, tooling]
summary: "Next.js 16's dev server holds a per-project single-instance lock: starting `next dev` for an app that already has a running dev process exits with status 1 and prints the existing instance's PID and log path ('Run kill <pid> to stop it') — even on a DIFFERENT port. In multi-session/multi-agent setups, do not kill the foreign process reflexively: it may belong to a parallel session. Find its port via lsof and share it, or coordinate."
problem: |
  `pnpm -F <app> dev --port 3010` fails immediately:

  ```
  - Dir:  .../apps/website
  - Log:  .next/dev/logs/next-development.log
  Run kill 70648 to stop it.
  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  ... `next dev --port 3010`
  Exit status 1
  ```

  Unlike the classic EADDRINUSE, this is NOT a port conflict — Next 16
  tracks one dev instance per app directory. A second instance is refused
  no matter which port you request. In shared working trees (parallel
  agent sessions, teammates on one machine) the lock holder is often
  someone else's live server.
solution: |
  Identify the existing instance and reuse it instead of killing it:

  ```bash
  # whose dev server is it, and on which port?
  ps -p 70648 -o command=
  lsof -nP -iTCP -sTCP:LISTEN | grep 70648   # → e.g. *:3001
  curl -s -m 5 -o /dev/null -w "%{http_code}" http://localhost:3001/
  ```

  If it answers, point your browser/tests at that port — same working
  tree, same code, including your latest edits via HMR. Only kill the
  PID when you OWN it (your own stale/zombie instance: listens but never
  responds).
gotchas:
  - "The lock outlives a responsive server: a hung instance (accepts TCP, never responds) still blocks new starts — verify with a timed curl before assuming it works."
  - "In multi-session setups the lock holder is presumptively a peer's live process — killing it tears down someone else's run. Check process age/owner first."
  - "The printed log path (.next/dev/logs/next-development.log) is the fastest way to see what the existing instance is doing."
last_validated_at: "2026-06-12"
---

## Verification

```bash
# the refusing PID is alive and listening?
ps -p <pid> > /dev/null && echo "lock holder alive"
lsof -nP -iTCP -sTCP:LISTEN | grep <pid>
# responsive?
curl -s -m 5 -o /dev/null -w "%{http_code}\n" http://localhost:<port>/
# 200 → reuse it; 000/timeout → zombie: safe to kill IF it's yours
```

## When this does not apply

- Next ≤15: a second `next dev` on another port starts fine; you only
  ever fought EADDRINUSE on the SAME port.
- Separate checkouts/worktrees of the same repo: each directory gets its
  own lock — parallel instances across worktrees work.

## Related

[[lsn_next_dev_hostname_hang]] — the companion failure mode where a dev
instance listens but never responds (exactly the zombie case above).
[[lsn_parallel_sessions_first_ask]] — the etiquette rule for foreign
state in shared working trees.