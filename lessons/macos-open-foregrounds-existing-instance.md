---
id: lsn_macos_open_foregrounds_existing_instance
title: "Diagnose stale macOS app UI after rebuild — `open` foregrounds the running instance, not your new build"
type: debugging_lesson
tier: community
summary: "In a build/open/verify loop for a native macOS app, `open` (LaunchServices) foregrounds an already-running process with the same bundle id instead of launching your fresh build. You verify the wrong window, and two instances from different paths can share on-disk state (a cached file). Verify with lsappinfo/ps which bundle path is frontmost; quit the old instance or install the new build over the old path before relaunching."
context:
  tools: ["xcode"]
  languages: []
  platforms: ["macos"]
  tags: ["macos", "launchservices", "open", "bundle-id", "verification", "build-verify-loop"]
---

## Symptom

You rebuild a native macOS app, run `open path/to/NewBuild.app` to check a change,
see the app window, and report "the app is now running the new version". But the
UI shows none of your changes — because the window belongs to an **older instance
that was already running**, not the build you just opened.

A tell: `ps` shows two processes with the same app name running from **different
bundle paths** (e.g. one from `/Applications`, one from your build-output
directory). Both are alive; only one is frontmost, and it may be the old one.

Retrieve this vetted convention when the symptom appears:

```
search_lessons({ query: "macos open app shows old version after rebuild",
                 platforms: ["macos"], tags: ["verification", "build-verify-loop"] })
```

## Root cause

`open` does not "launch this binary". It asks **LaunchServices** to activate the
application identified by the bundle. When a process with the same
`CFBundleIdentifier` is already running, LaunchServices **reuses and foregrounds
that instance** instead of starting a second copy of your fresh build. (`open -n`
forces a new instance, which is the opposite failure — now you have two.)

Two independent consequences bite here:

1. **Wrong instance verified.** The window you see is the stale process; your
   change never loaded.
2. **Shared on-disk state.** Two instances of the same app share the same
   `~/Library/Application Support/<app>` / `~/Library/Containers/<app>`. If the
   app persists state (a cached scan, a session file), the old instance can
   overwrite what the new one just wrote on quit or on its own timer.

## Detection

Ask LaunchServices what is actually frontmost, and enumerate every instance with
its bundle path:

```bash
# Which bundle is frontmost right now:
front=$(lsappinfo front)
lsappinfo info -only bundlepath "$front"

# Every running instance of the app, by full executable path:
ps aux | grep "MyApp.app/Contents/MacOS" | grep -v grep \
       | awk '{print $2, $11}'
```

Two rows from different bundle paths = you have an old instance shadowing the new
build. `lsappinfo list | grep -A6 "MyApp"` also shows each instance's
`bundle path` and `pid`.

## Fix

Before relaunching, make the on-disk build the only one that can run:

```bash
# 1. Quit every running instance (graceful):
osascript -e 'quit app "MyApp"'            # or: kill -TERM <pids>

# 2. Put the new build where it will be launched from, over the old path:
ditto "build/.../Release/MyApp.app" "/Applications/MyApp.app"

# 3. Launch from that canonical location and confirm the pid/path:
open "/Applications/MyApp.app"
ps aux | grep "MyApp.app/Contents/MacOS" | grep -v grep | awk '{print $2,$11}'
# Expect EXACTLY ONE row, from /Applications.
```

Then verify the change by a build-only marker (a new UI element, a version
string) — not merely "a window appeared".

This is the macOS-app instance of the general rule "verify the actual side
effect, not the command's success summary": `open` returning 0 tells you
LaunchServices accepted the request, not that your binary is the one now on
screen.

## When this does NOT apply

- **No prior instance running.** First launch of the day: `open` starts your
  build directly, no shadowing possible.
- **You truly want multiple instances.** Some apps support `open -n` by design;
  then two instances is intended — but still confirm which one you are looking at.
- **Distinct bundle identifiers.** If the new build has a different
  `CFBundleIdentifier` (a separate dev/beta id), LaunchServices treats it as a
  different app and launches it — the shadowing does not occur.

## Verification

A clean state is exactly one process, from the path you intend, showing a
build-only marker:

```bash
ps aux | grep "MyApp.app/Contents/MacOS" | grep -v grep | wc -l   # == 1
```

If the count is 2, an old instance is still live — quit it and relaunch before
trusting anything you see in the window.
