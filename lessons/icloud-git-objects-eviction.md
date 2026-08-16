---
id: lsn_icloud_git_objects_eviction
title: Fix iCloud-evicted .git/objects with same-directory rename — `cat` and `cp` hang for minutes
type: debugging_lesson
tier: community
lesson_class: general
quality_tier: hand-vetted
context:
  tools:
    - claude-code
    - cursor
    - git
  languages: []
  platforms:
    - macos
  tags:
    - icloud
    - git
    - filesystem
    - macos-dev
summary: When a git repo lives under an iCloud-synced path (~/Documents, ~/Desktop), iCloud's FileProvider can evict loose object-files in .git/objects/ into a state where every read() call blocks for minutes. brctl download does not help — it's a lock, not pure eviction. Recovery is same-directory rename, not cat or copy.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The symptom

- `git status`, `git diff`, or any plumbing command hangs silently for minutes
  with no output. No CPU usage, no error.
- The hang persists across Ctrl-C — zombie `git` processes accumulate
  (IDE polling adds 5-10 per minute).
- `lsof -p <pid>` shows the hung process has a file descriptor open on
  something in `.git/objects/<XX>/<rest>`.
- `git fsck` from a fresh shell may report `unable to read <sha>` or
  `unable to read tree <sha>`.
- `cat .git/objects/<XX>/<rest>` hangs the same way. So does `md5`, `file`,
  or anything else that calls `read()`.

## What's actually happening

iCloud's FileProvider has marked the object-file as evicted-and-syncable
but a read attempt has put it into a stuck state — the kernel waits for
iCloud to materialize the file, iCloud waits for something else, the
read never returns. `brctl download <path>` does NOT unstick it; that
command is for pure eviction, not for files already in this lock state.

This is non-monotone failure: the repo can be fine for weeks, then tip
over once three preconditions line up:

1. Loose-object count over ~500 in `.git/objects/[0-9a-f][0-9a-f]/`
   (critical above ~1000). `git gc` ran a long time ago.
2. Volume capacity at ≥ 90% — iCloud's "Optimize Mac Storage" starts
   aggressively evicting.
3. `defaults read com.apple.bird optimize-storage` returns `1`.

All three at once tips the repo. Any one missing keeps it stable.

## Recovery (in this order)

### 1. Soft path — try first, costs less than a second

```bash
git reset --mixed HEAD
```

This rebuilds the index from HEAD's tree, releasing index references to
the stuck object. Works in the majority of cases. No data loss — only
staged changes are unstaged (working tree untouched).

### 2. Hard path — same-directory rename

```bash
mv .git/objects/<XX>/<rest> .git/objects/<XX>/STUCK-RECOVERY-<rest>
git fetch          # re-fetches the object as a loose file
git reset --mixed HEAD
```

The `mv` within the same directory is a pure `rename()` syscall — no
`read()` involved. That's why it works on a stuck file. After the
rename, `git fetch` repopulates the object from origin.

### 3. What NOT to do

- **Never `mv` across volumes** (e.g., `mv .git/objects/<XX>/<rest> /tmp/`).
  That triggers an internal copy-then-unlink — and copy means read, so it
  hangs.
- **Don't `rm` the stuck file blind.** `rm` also calls into the fs layer
  and may hang. Use the same-directory rename to defuse first.
- **Don't restart your machine hoping it clears.** It usually doesn't,
  and you lose your shell state.

## Prevention

- Run `git gc` weekly, or whenever loose-object count crosses 500.
- Keep volume capacity below 85%.
- Run `git fsck --full` monthly to catch silent corruption early.
- Long-term structural fix: move repos OUT of iCloud-synced paths.
  Symlink from `~/Documents/` into `~/git/` (kept outside iCloud's
  scope) gives you the convenient path without the failure mode.

## When this does not apply

If `git status` returns in under a second and `git fsck` reports clean,
the repo is not in the stuck state. The recovery steps above are safe
but pointless. Move on. This convention also does not apply to repos
hosted on non-iCloud cloud-storage (Dropbox, Google Drive) — those have
different file-provider mechanics and need their own diagnosis.

## Detection in scripted git-sync workflows

If you have a wrapper script that runs git commands in a loop (sync
cron, CI mirror, etc.), treat these stderr signals as corruption:

- `unable to read <sha>`
- `unable to read tree <sha>`
- `Stale NFS file handle`
- `mmap failed`
- timeouts on subprocess calls that should return in milliseconds

Trigger the soft-path recovery automatically. Then surface a notification
so the user knows iCloud bit the repo again.

Before doing anything else, kill any stale `git` processes from previous
hung IDE polls:

```bash
pkill -f 'git (status|diff|fetch|fsck)' || true
```

Otherwise the recovery's own `git` calls will queue behind the zombies
on the same stuck fd.
