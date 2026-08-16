---
id: lsn_macos_app_quit_wait_crashpad
title: "Diagnose a hung wait-for-app-quit loop on macOS: exclude chrome_crashpad_handler, count via ps not pgrep -f"
type: debugging_lesson
tier: community
summary: "Automation that acts after an app quits (bundle swap + resign) needs two things from its process check: it must actually see the app — pgrep -f on the bundle path reported 0 while 17 processes ran; use ps -Ao comm= with grep -F on <App>.app/Contents/ — and a WAIT loop must exclude chrome_crashpad_handler, which detaches to PPID 1 and survives quit, so a raw count never reaches zero. Refusal checks can afford that false positive; wait loops cannot."
context:
  tools: [claude-code, cursor, windsurf]
  languages: [bash]
  platforms: [macos, electron]
  tags: [macos, electron, process-detection, crashpad, codesign, automation]
---
## Two different questions, one easy conflation

Bundle-modifying automation (extension swap, resign, updater) asks one of two
questions, and they need **different** failure directions:

- **Refuse-while-running**: "is the app open? then abort." A false positive
  (app closed, check says open) merely aborts too eagerly — safe.
- **Wait-until-quit**: "block until the app is gone, then act." A false
  positive here means the loop **never terminates** — broken.

The same process listing serves both, but the filter must differ.

## Detection that actually sees the app

```bash
APP="/Applications/YourApp.app"
ps -Ao comm= | grep -cF "$APP/Contents/"     # counts every process from the bundle
```

Measured on 2026-08-15: this returned 17 while `pgrep -f "$APP/Contents/MacOS"`
returned **0** for the same running Electron app. Whatever the platform quirk
behind pgrep's blindness, the asymmetry is fatal in the dangerous direction —
"not running" while the app runs invites a resign that kills the app silently.
Use the `ps -Ao comm=` + fixed-string `grep -F` form; it matches the on-disk
executable paths (`MacOS/App`, helper apps in `Frameworks/`) without regex
surprises from spaces and parentheses in helper names.

## The waiting trap: crashpad survives quit

Electron/Chromium apps run a `chrome_crashpad_handler` from inside the bundle.
It **detaches** (parent = launchd, PPID 1) and can outlive the app by hours —
measured: two orphan handlers from sessions quit long before. A wait loop over
the raw count therefore hangs at "1 process left" forever:

```bash
# WRONG for waiting — includes crashpad orphans
running() { ps -Ao comm= | grep -cF "$APP/Contents/"; }

# RIGHT for waiting — the app is "quit" when its real processes are gone
blockers() { ps -Ao pid=,comm= | grep -F "$APP/Contents/" | grep -v chrome_crashpad_handler; }
until [ "$(blockers | wc -l)" -eq 0 ]; do sleep 2; done
```

For refuse-while-running, keeping crashpad in the count is acceptable (worst
case: an unnecessary abort) — but printing the matching process names alongside
the count turns every false refusal into a one-glance diagnosis:

```bash
blockers | sed "s|.*/Contents/|  |" | sort -u   # names, not just a number
```

## Why this pairs with resign

The usual reason to wait for quit is that the action breaks the code signature:
on Apple Silicon, launching an ad-hoc-signed app whose bundle was modified
without re-signing gets the app killed **silently** — no dialog, no crash
report. Re-signing a *running* app is equally fatal. So the safe sequence is
wait-for-quit → modify → `codesign --force --deep -s -` → verify — see the
bundling section of [[lsn_electron_run_as_node_bundled_cli]] for making the
resign part of the script rather than an instruction after it.

## When this does NOT apply

- **Non-Electron apps** have no crashpad handler — the raw count works for
  waiting, though the `ps`-vs-`pgrep` point still stands.
- **Apps with intentional background residents** (menu-bar helpers, launch
  agents): "quit" is ambiguous; the exclusion list must be curated per app,
  not copied from here.
- **Linux/Windows**: different process models and signing rules; only the
  refuse-vs-wait asymmetry carries over.

```
search_lessons({
  query: "wait for macos app quit process detection crashpad resign",
  platforms: ["macos"],
  tags: ["process-detection"]
})
```
