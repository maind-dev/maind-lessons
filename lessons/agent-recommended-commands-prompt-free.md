---
id: lsn_agent_recommended_commands_prompt_free
title: Agent command blocks for remote shells must be prompt-free — interactive auth corrupts the paste-buffer
type: workflow_best_practice
tier: community
lesson_class: general
summary: When an agent recommends a multi-command block for a remote shell, every command must be non-interactive. An interactive prompt in the middle (git pull without preconfigured auth, docker login, npm login, gh auth login) consumes the subsequent paste-buffer lines as input — silently corrupting them. This is structural, not a user mistake; the agent is responsible for choosing prompt-free variants.
context:
  tools:
    - claude-code
    - cursor
    - windsurf
    - copilot
  languages: []
  platforms: []
  tags:
    - agent-workflow
    - remote-shell
    - ssh
    - git-auth
    - command-recommendations
    - paste-buffer
last_validated_at: "2026-05-28"
---

## The failure mode

A user pastes this block (agent-recommended) into an SSH shell:

```bash
git config --global credential.helper store
git pull
cd ../foo && rm -rf .state/
```

If git lacks credentials, the second line opens an interactive Username/Password prompt. The shell does not buffer the remaining lines for after-the-prompt — instead, those lines feed directly into git's `read()` call. Result:

```
Username for 'https://github.com': cd ../foo && rm -rf .state/
Password for 'https://cd%20..%2Ffoo%20%26%26%20rm%20-rf%20.state%2F@github.com':
```

The remaining commands are silently misappropriated as auth inputs. After the (failed) git pull, the shell prompt returns — but the `cd ../foo && rm -rf .state/` step is gone. The user sees only an auth failure and has no obvious clue that subsequent work was silently dropped.

## Why this is the agent's responsibility

A user pasting an agent-recommended block expects it to be self-contained. They cannot reliably re-orchestrate the agent's intent line-by-line — that defeats the point of receiving a block. Asking the user to "paste line by line" or "wait for prompts" pushes execution complexity from the agent (which knows the structure) onto the user (who shouldn't have to track which line might prompt).

The correct discipline: agents recommend the variant that completes without prompts, even if it is slightly less idiomatic.

## Recommended discipline

### For git auth

Avoid (introduces a prompt):
```bash
git config --global credential.helper store
git pull
```

Prefer (no prompt):
```bash
git remote set-url origin "https://x-access-token:<PAT>@github.com/<owner>/<repo>.git"
git pull
```

### For docker auth

Avoid:
```bash
docker login ghcr.io
docker pull ghcr.io/...
```

Prefer:
```bash
echo "$GHCR_PAT" | docker login ghcr.io --username "<user>" --password-stdin
docker pull ghcr.io/...
```

### For npm publish auth

Avoid `npm login` followed by `npm publish` in the same block.

Prefer:
```bash
npm config set //registry.npmjs.org/:_authToken="$NPM_TOKEN"
npm publish
```

### For SSH key setup

Avoid blocks that include `ssh-keygen` interactively (prompts for passphrase).

Prefer: `ssh-keygen -t ed25519 -N "" -f ~/.ssh/<name> -C "<comment>"` (empty passphrase explicit) or `-N "$SSH_KEY_PASSPHRASE"` from env.

### Self-check before sending the block

The agent should mentally simulate execution: "does any line require interactive input?" If yes — either replace with a non-interactive variant, or split the recommendation explicitly with a "stop here, run this first, then continue with these lines after the prompt completes" boundary marker.

## When this does not apply

- **Single-command recommendations.** A standalone `git pull` is fine — there is no subsequent line in the paste-buffer to corrupt.
- **Explicit setup-flow context.** If the user has asked "walk me through setting up auth interactively," prompts are the point.
- **OAuth device codes / MFA challenges.** Some flows genuinely require user interaction (browser-based OAuth, hardware-key tap). Isolate the interactive step as a single command, then provide a fresh block for the post-auth follow-up.
- **Local interactive shells where the user expects to type.** The rule is specifically about copy-pasted multi-line blocks. A user actively typing one command at a time can handle prompts naturally.

## Detection and cross-references

If you see an SSH session log with this pattern — URL-encoded suspicious characters in a prompt URL — you have hit this failure mode:

```
Password for 'https://git%20config%20--global%20...@github.com':
```

The URL-encoded segment is the next line of the user's paste-buffer that got misappropriated into the username field. The cure is not "user education" — the cure is replacing the recommended block with a prompt-free variant.

Quick discovery of related vetted conventions:

```
search_lessons({
  query: "remote shell auth prompt block",
  tools: ["claude-code"],
  tier: "all"
})
```

Related curated conventions:

- [[lsn_surface_silent_errors_first]] — make silent failures visible with `console.error` before analysis; this convention is the upstream-prevention sibling: avoid creating the silent failure in the first place.
- [[lsn_reversibility_blast_radius_gate]] — evaluate each recommended action; prompt-corruption-blocks have low reversibility (silent drop of intended commands) and variable blast-radius (`rm -rf` could be in the lost lines).
- [[lsn_subagent_edit_not_write]] — same family of "the agent's choice of mechanism creates silent failure modes" patterns.

## Generalisability

This applies to any agent (Claude Code, Cursor, Windsurf, Copilot, ChatGPT, custom orchestrators) recommending shell commands to any non-interactive execution context (SSH, container exec, CI, automation scripts). The mechanism is universal to terminal stdin behavior, not specific to any one tool or platform.
