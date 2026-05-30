---
id: lsn_settings_local_hook_path_migration
title: Fix silently-broken hooks after workspace path migration — `.claude/settings*.json` paths are hard-coded
type: debugging_lesson
tier: community
lesson_class: general
quality_tier: hand-vetted
context:
  tools:
    - claude-code
  languages: []
  platforms: []
  tags:
    - hooks
    - workspace-migration
    - silent-failure
    - settings
summary: >-
  Hooks declared in `.claude/settings.json` and `.claude/settings.local.json`
  use absolute paths. When the repository moves (iCloud-out, rename, symlink
  refactor), the paths still resolve to the old location. With shell
  suppression (`> /dev/null 2>&1`, `|| true`), the broken hook fails silently
  — no banner, no toast, no error. The feature the hook was wired to
  silently stops working.
last_validated_at: "2026-05-18"
upvotes: 0
---

## The symptom

A feature that depended on a Claude Code hook — auto-formatter,
loc-counter, sync-tracker, telemetry uploader — stops working without
any error message. The hook still fires on `Edit` / `Write` /
`PostToolUse` etc., but the command behind it points at a path that no
longer exists.

If you tail the JSON logs you'll see the hook execution; you won't see
that it crashed because the original config wrapped it in
`> /dev/null 2>&1` or `|| true`.

## What's actually happening

Hook commands in `.claude/settings*.json` are stored as literal strings:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "bash /Users/alex/Documents/Projects/my-repo/scripts/loc.sh > /dev/null 2>&1"
        }]
      }
    ]
  }
}
```

When the repo moves from `~/Documents/Projects/my-repo/` to
`~/Projects/my-repo/` (or any other rename), the absolute path in the
config still points at the old location. `bash` runs, can't find the
script, exits non-zero — but the suppression makes the failure
invisible.

Three files commonly hold these hard-coded paths:

- `~/.claude/settings.json` — user-global
- `<repo>/.claude/settings.json` — project, checked in
- `<repo>/.claude/settings.local.json` — project, gitignored

The user-global file usually gets migrated as part of a global-config
sweep. The two project-local files frequently get missed.

## The fix

Audit all three settings files before the next tool-use after any
workspace move:

```bash
for f in \
  ~/.claude/settings.json \
  <repo>/.claude/settings.json \
  <repo>/.claude/settings.local.json
do
  [ -f "$f" ] && echo "=== $f ===" && grep -c "<old-path>" "$f"
done
```

Any non-zero count is a broken hook. Replace:

```bash
sed -i '' 's|<old-path>|<new-path>|g' "<file>"
python3 -c "import json; json.load(open('<file>'))"   # verify JSON-valid
```

Then verify the new path actually exists and is executable:

```bash
ls -la "<new-path>/scripts/<script>.sh"
```

Mode bits should include `x` for the user. If not: `chmod +x <path>`.

## Find silent failures proactively

When a hook-driven feature seems "off but I can't tell why," temporarily
remove the output suppression:

```diff
- "command": "bash /path/to/script.sh > /dev/null 2>&1"
+ "command": "bash /path/to/script.sh"
```

Re-trigger the hook. The first `Edit` after the change will surface
whatever stderr the script was producing. Then either fix the path or
re-add the suppression once the script is healthy.

General principle: every `> /dev/null 2>&1`, `|| true`, `2>/dev/null`
in a hook command is a candidate hiding place for a silent bug. Audit
them when you migrate paths, rename binaries, or update dependencies.

## When this does not apply

If your hooks all use commands available on `$PATH` (e.g., `npm run
lint`, `pnpm format`, `mise run x`), there's no absolute path to break.
Workspace moves don't affect these.

The convention also doesn't apply when you've explicitly designed the
hook to fail-silent — for example, a "best-effort" upload that
shouldn't block the workflow. In that case, route stderr to a log file
instead of dropping it: `2>> ~/.claude/hook-errors.log`. You keep the
silent-fail semantics but get an audit trail.
