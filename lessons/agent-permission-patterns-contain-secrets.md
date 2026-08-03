---
id: lsn_agent_permission_patterns_contain_secrets
title: Agent permission allow-patterns contain credentials — treat the settings file as a secrets file
type: workflow_best_practice
tier: community
summary: >-
  Coding-agent permission rules (Claude Code `settings.local.json` and the
  equivalents in other clients) match on WHOLE COMMAND LINES, so real allow-lists
  accumulate database URLs with passwords, `apikey:` headers and internal
  hostnames. The file is named "settings", is gitignored and feels like
  configuration — so it gets pasted into issues and swept into backups. Treat it
  as a secrets file, and never let a tool upload its patterns for comparison.
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  languages: []
  platforms: []
  tags:
    - secrets
    - agent-configuration
    - permissions
    - data-exfiltration
    - tooling
---

## The shape of the problem

Agent permission rules are string matchers over the command the agent wants to
run. To be precise enough to be useful, they end up containing the command —
all of it. A real allow-list grows entries like:

```
Bash(psql postgresql://user:password@db.internal:5432/app -c "…")
Bash(curl … -H "apikey: <token>" …)
Bash(ssh deploy@bastion.corp.example …)
```

None of these were meant as secrets storage. They are there because someone got
tired of confirming the same command, and the pattern had to match it.

## Why it stays invisible

Three properties conspire:

- **The name.** `settings.local.json` reads as preferences, not credentials.
  Nobody applies secrets hygiene to a settings file.
- **The gitignore.** It is excluded from the repo, which *feels* like the risk
  is handled. It isn't — gitignore protects one channel out of several.
- **The debugging path.** Permission problems are debugged by showing the rules.
  "Paste your settings and I'll look" is the natural next sentence in a support
  thread, an issue, or a message to a colleague.

Backups and cloud-synced home directories pick it up too, silently.

## What to do

1. **Treat the file as a secrets file.** Redact before sharing it, anywhere.
   If you would not paste your `.env`, do not paste this either.
2. **Prefer narrow patterns over full command lines.** `Bash(psql:*)` is usually
   as useful as the full connection string and carries nothing. The widest safe
   pattern beats the most precise one here — the opposite of the usual advice,
   because precision is what drags the secret in.
3. **Rotate what is already in there.** The entries accumulated over months; the
   credentials in them are probably still live.

## For tool authors — the part that is easy to get wrong

Any tool that audits, lints or syncs these rules must **compare locally and send
only findings**. Uploading the local patterns for a server-side comparison turns
a harmless-sounding "check my permissions" feature into an exfiltration channel
that nobody suspects.

Hashing the patterns does not fix it: the value space is small and guessable
(a hostname plus a known command shape), so a hash is reversible in practice.

Ship the comparison logic down; send the verdict up. Note that this is a
deliberate **exception** to the usual default in [[lsn_backend_first_default]]:
the burden of proof normally lies on client-side code, but here the transport
itself is the risk, so the logic moves to the data rather than the data to the
logic.

## When this does not apply

- Rules that are pure verbs with no arguments (`Bash(ls:*)`) carry nothing.
- Managed/enterprise configurations authored centrally that never contained a
  developer's own commands.

## Finding this again

```ts
search_lessons({ query: "permission allow patterns secrets settings.local.json", tools: ["claude-code"] })
```
