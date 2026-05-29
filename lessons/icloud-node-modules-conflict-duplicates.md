---
id: lsn_icloud_node_modules_conflict_duplicates
title: Fix iCloud-induced `node_modules` duplicates — sleep between `rm -rf` and `npm install`, never chain with `&&`
type: debugging_lesson
tier: community
lesson_class: general
quality_tier: hand-vetted
context:
  tools:
    - npm
    - pnpm
    - yarn
  languages: []
  platforms:
    - macos
  tags:
    - icloud
    - node-modules
    - dependency-install
    - macos-dev
summary: >-
  When a project lives under an iCloud-synced path (~/Documents,
  ~/Desktop), `npm install` races with iCloud's file-provider. iCloud
  creates conflict-copies (`file 2.js`, `enoent 2.js`) inside
  `node_modules/` mid-install, which then poison module resolution at
  runtime. The fix is to delete with a pause, verify the directory is
  actually gone, then install — never chain with `&&`. The permanent
  fix is a `.nosync` symlink.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The symptom

After `npm install` (or `pnpm`, or `yarn`), the app fails at runtime
with one of:

- `Unable to resolve module <name>` from Metro / webpack
- `Cannot find module '<name>'` from Node
- `ENOTEMPTY: directory not empty` mid-install
- A bundle that builds but crashes on a missing file inside a
  dependency

If you look inside `node_modules/`:

```bash
find node_modules -maxdepth 3 -name "* 2*" | head -5
```

Any hit is iCloud-conflict-copies — `index 2.js`, `parse 2.js`,
`enoent 2.js`. iCloud created them when it raced with `npm`'s file
writes. The original files were renamed during the conflict, so the
import resolution finds the wrong file (or no file at all).

## What's actually happening

iCloud's FileProvider watches `~/Documents/` and `~/Desktop/` (and any
folder enrolled in "Desktop & Documents" sync). When `npm install`
writes 50K files into `node_modules/`, iCloud doesn't get the kernel-
level notifications fast enough — it sees half-written files, marks
them as conflicts, and creates `<file> 2.<ext>` copies. The original
filename now points at a stale version; the import resolution becomes
non-deterministic.

`rm -rf node_modules && npm install` makes this worse, not better:
`rm -rf` returns to the shell before iCloud has released file handles
on every file inside. `npm install` starts writing into a directory
that iCloud thinks is still alive — duplicate creation hits the new
files immediately.

## The fix

### Recovery (when duplicates are already present)

```bash
rm -rf node_modules
sleep 3                  # let iCloud release file handles
ls node_modules 2>&1     # MUST print "No such file or directory"
npm install --legacy-peer-deps   # or pnpm / yarn equivalent
```

The `sleep 3 && ls` step is non-negotiable. If `ls` prints anything
other than "No such file," iCloud still holds handles — wait longer
and re-check before installing.

Do NOT delete `package-lock.json`. Without the lockfile, dependencies
resolve inconsistently across machines and CI; that's a different and
worse failure mode than the iCloud one.

### Permanent fix (`.nosync` symlink)

macOS treats any path containing `.nosync` as opted-out of iCloud
sync. Rename `node_modules` to `node_modules.nosync` and symlink:

```bash
mv node_modules node_modules.nosync
ln -s node_modules.nosync node_modules
```

Node/Metro/webpack follow the symlink transparently; iCloud ignores
the `.nosync` directory entirely. Add `node_modules.nosync/` to
`.gitignore` alongside the existing `node_modules/`.

After future `rm -rf node_modules.nosync`, you need to re-create the
symlink:

```bash
rm -f node_modules
mkdir -p node_modules.nosync
ln -s node_modules.nosync node_modules
npm install --legacy-peer-deps
```

## When this does not apply

If your project lives outside iCloud-synced paths (e.g., `~/Code/`,
`~/git/`, `~/Developer/` — none of these are in the default sync
scope), the race doesn't happen. `rm -rf && npm install` works fine.

The convention also doesn't apply to non-macOS systems. iCloud's
file-provider is the specific mechanism; Linux/Windows have their
own dependency-install gotchas but not this one.

## Verification

After install, spot-check that the most common targets of iCloud
conflict-copy aren't broken:

```bash
test -f node_modules/cross-spawn/lib/parse.js && echo "cross-spawn ok"
ls node_modules | grep -c " 2$"   # should be 0
find node_modules -maxdepth 3 -name "* 2*" -type f | wc -l   # should be 0
```

Any non-zero count means duplicates leaked in; redo the recovery
sequence and consider switching to the `.nosync` symlink permanently.
