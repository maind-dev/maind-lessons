---
id: lsn_global_cli_install_silently_stale
title: "Diagnose a client stuck on an old version — a globally installed CLI never self-updates, and restarting does not help"
type: debugging_lesson
tier: community
context:
  tools: [npm, nvm, claude-code, cursor, windsurf]
  languages: [javascript, typescript]
  platforms: [node, mcp]
  tags: [npx, global-install, nvm, version-drift, silent-failure, rollout]
summary: >
  Switching a client config from `npx -y <pkg>` to a globally installed bin trades
  the npx re-resolve race for silent staleness: `npx` resolves the registry on every
  run, a global bin never does. Restarting the client changes nothing, every release
  looks shipped, and the machine can sit versions behind for weeks with no error.
last_validated_at: "2026-08-03"
---

## Symptom

A release is published and verified — `npm view <pkg> dist-tags` shows the new
version as `latest` — yet the new behavior never appears. Restarting the client,
the IDE, or the whole machine changes nothing. There is no error: the old version
runs perfectly, it is simply old.

The tell is that **nothing fails**. A stale dependency usually announces itself
through a missing export or a schema mismatch. A stale *client* just keeps doing
the previous thing correctly.

### Detect

Check every Node version, not just the active one — nvm keeps a separate global
tree per version, and the wrong one can be first on `PATH` inside a subshell:

```bash
# What does PATH actually resolve, and to which version?
which -a <bin-name>
<bin-name> --version

# Per Node version (the one that surprises people):
for d in ~/.nvm/versions/node/*/lib/node_modules/@org/tool/package.json; do
  v=$(echo "$d" | sed 's|.*/node/\([^/]*\)/.*|\1|')
  echo "  node $v → $(node -p "require('$d').version")"
done

# Registry truth to compare against:
npm view @org/tool version
```

A measured example: a machine whose config had been switched to a global bin was
running **0.14.0** while `latest` was **0.18.0** — four minor versions, several
weeks, across *both* installed Node versions. It surfaced only because a new
release added a field that the server could see was never being sent. Without
that accidental probe, nothing would have reported it.

## Root cause: two consumption modes with opposite update semantics

| Config shape | When is the version resolved? | Does a restart update it? |
|---|---|---|
| `"command": "npx", "args": ["-y", "@org/tool"]` | on **every** process start, against the registry | **yes** |
| `"command": "org-tool"` (global bin) | once, at `npm i -g` time | **no — never** |

Teams often move from the first to the second deliberately, and for a good
reason: `npx -y` re-resolves on every launch, which can race with a partially
written cache (`ENOTEMPTY`, half-extracted packages, "failed to connect" on
startup). Pinning to a globally installed bin removes that race.

The cost is rarely priced in: **the rollout mechanism was the npx call.** Remove
it and there is no longer anything that pulls a new version — only an explicit
`npm i -g` does, and nothing in the system asks for one.

### `nvm default-packages` does not close the gap

`~/.nvm/default-packages` is often assumed to be the safety net. It is not:

```
# ~/.nvm/default-packages
@org/tool
```

This installs the package **when a new Node version is created**. It never
touches an existing one. Presence is guaranteed; freshness is not. A machine that
has not added a Node version in months has not updated that package in months.

## Fix

```bash
npm i -g @org/tool@latest && <bin-name> --version
```

Then restart the client processes — the running ones still hold the old file.

Two traps in the cleanup:

- **A pinned `prefix` can make per-version installs collapse into one.** Check
  `npm config get prefix` for each Node version before assuming you need N
  installs. If they all point at one directory, a single install covers all.
- **Old per-version bins survive and stay executable.** After a prefix change,
  `~/.nvm/versions/node/<old>/bin/<bin-name>` can remain, pointing at an ancient
  copy. It is dormant while `PATH` favours the new version and wakes up the moment
  something runs under `nvm use <old>`. Remove it, or it becomes the same bug in a
  second location.

### Verification

```bash
[ "$(<bin-name> --version)" = "$(npm view @org/tool version)" ] \
  && echo "current" || echo "STALE — npm i -g @org/tool@latest"
```

Worth running as a periodic check rather than at incident time — the failure mode
has no symptom of its own, so it only ever gets noticed by accident.

## Prevention — pick one, deliberately

- **Keep `npx -y` in the client config** and solve the cache race directly (pin an
  exact version, pre-warm the cache, or use a launcher that retries). The rollout
  then stays self-executing.
- **Keep the global bin** and add an explicit refresh step to the release
  checklist — `npm i -g <pkg>@latest` on every machine — plus the verification
  one-liner above in CI or a login shell. The point is that *somebody* must now do
  what `npx` used to do; if nobody is named, the answer is nobody.

Whichever you choose, write down which mechanism updates the client. The failure
here was not the choice — it was that the choice removed a mechanism and did not
replace it.

## When this does NOT apply

- Packages consumed through a lockfile in a project (`pnpm-lock`, `package-lock`)
  — those are resolved by the lockfile and update when the project updates.
- Clients that self-update (VS Code extensions with marketplace auto-update, apps
  with a built-in updater). The gap is specific to a bin installed once by hand.
- A deliberate pin for reproducibility — as long as the pinned version is written
  down somewhere a human reads. A pin nobody recorded is indistinguishable from
  this bug.

## Related

Surface this and its mirror image from a session:

```typescript
search_lessons({
  query: "global install stale version npx never re-resolves client outdated",
  tools: ["npm"],
  tags: ["global-install", "version-drift"],
});
get_lesson({ id: "lsn_npx_published_source_needs_version_bump" });
```

- [[lsn_npx_published_source_needs_version_bump]] — the mirror image on the
  publish side: the version was never bumped, so `npx` correctly serves the old
  one. Here the bump was correct and the *consumer* never re-resolved. Reading
  both together gives the full "shipped but not delivered" picture.
- [[lsn_verify_cli_side_effects_second_source]] — same discipline: confirm a
  release landed against an independent source instead of trusting the summary
  line of the publish command.
