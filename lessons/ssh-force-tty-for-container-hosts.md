---
id: lsn_ssh_force_tty_for_container_hosts
title: Fix PTY-missing SSH error on TTY-strict endpoints (RunPod, jump-hosts) with forced -tt
type: debugging_lesson
tier: community
lesson_class: general
summary: Standard SSH command-mode runs without a TTY. Some endpoints — RunPod, corporate jump-hosts, container-routing proxies — reject non-TTY sessions with a PTY-missing error. Fix is to force TTY with `-tt` (double-t — request TTY even when stdin is not a terminal). For complex remote scripts the cleaner path is to work inside an already-open interactive SSH session, avoiding nested-quote escaping over TTY-forced one-liners.
context:
  tools:
    - claude-code
    - cursor
    - windsurf
    - copilot
  languages: []
  platforms: []
  tags:
    - ssh
    - tty
    - remote-execution
    - container-hosts
    - runpod
    - jump-hosts
    - automation
last_validated_at: "2026-05-29"
---

## The failure mode

Standard SSH one-liner from a local shell to a remote host:

```bash
ssh user@host 'echo hello; uptime'
```

Against a normal Linux host this prints "hello" plus uptime and exits cleanly. Against RunPod (and some other endpoints — certain corporate jump-hosts, container-routing proxies, hardened bastion-hosts) it fails with `Error: Your SSH client doesn't support PTY`.

The endpoint expects an interactive session (TTY allocated). The standard `ssh host 'cmd'` form does NOT allocate a TTY by default — that is the SSH protocol behavior for non-interactive use. The endpoint enforces TTY presence and rejects the connection.

The error message is misleading: the SSH client supports PTY, it just was not asked to allocate one for this call. The fix is on the client side, not the endpoint.

## The fix

Force TTY allocation with `-tt`:

```bash
ssh -tt user@host 'echo hello; uptime'
```

The `-t` flag *requests* a TTY (can still fail if stdin is not a terminal). `-tt` *forces* TTY allocation regardless of stdin. For automated calls from scripts, cron jobs, CI, or background commands, `-tt` is the reliable form.

Side-effect: TTY-forced output may contain `\r\n` line endings (carriage returns) instead of plain `\n`. If you pipe TTY-forced SSH output into JSON parsing, regex, or aggregation, strip carriage returns first:

```bash
ssh -tt user@host 'python3 /tmp/aggregate.py' | tr -d '\r'
```

Without the strip, downstream tools see lines like `key:value\r\n` and matching/parsing fails silently or oddly.

## When this does not apply

- **Endpoints that work without `-t`**: most standard Linux hosts (your own VPS, EC2 instances with default sshd config) accept non-TTY command execution. Do not add `-tt` reflexively — it adds the `\r\n` overhead for no benefit and can change behavior of commands that detect a TTY (paging, color codes).
- **scp / rsync / sftp**: these protocols do not use a remote shell at all; the TTY question does not arise.
- **SSH with no command (pure interactive session)**: TTY is allocated by default for interactive sessions. The TTY-strict endpoints only reject non-interactive command execution.

## When you should NOT use TTY-forced one-liners anyway

If the remote command is more than a single short line, `-tt` with nested quoting (single quotes inside double quotes inside SSH-arg quotes) becomes a debugging nightmare:

```bash
# This is fragile and likely to fail silently on the first edit:
ssh -tt host 'bash -lc "echo \"hits: \$(grep -c \\\"foo\\\" file)\""'
```

The pragmatic alternative is to work inside an already-open interactive SSH session (where TTY is naturally allocated and there is no nested quoting). If automation requires it, save the remote script as a file first and execute it as a single token:

```bash
# Step 1 (one-time): copy the script to remote
scp ./remote-script.sh user@host:/tmp/remote-script.sh

# Step 2 (each invocation): one short command, no nesting
ssh -tt user@host 'bash /tmp/remote-script.sh'
```

Or pipe via heredoc, no escaping needed:

```bash
ssh -tt user@host bash <<'REMOTE_EOF'
echo "no escaping needed"
grep -c 'foo' /tmp/file
REMOTE_EOF
```

## Detection in retrospective

The error string is distinctive and worth grepping for in session transcripts: `Your SSH client doesn't support PTY`. If you see this on an endpoint that previously worked, check whether the SSH command form changed from interactive to non-interactive (e.g., recently wrapped in a script or cron job).

Conversely, if a script that worked on one host fails on a new host with this error, the new host is TTY-strict — add `-tt`.

## Cross-references and generalisability

Quick discovery:

```
search_lessons({
  query: "ssh tty pty remote command execution",
  tools: ["claude-code"],
  tier: "all"
})
```

Related curated conventions:

- [[lsn_agent_recommended_commands_prompt_free]] — broader theme: agent-recommended remote commands should be robust against terminal-state assumptions, including TTY.
- [[lsn_shell_output_sentinel_markers]] — when piping TTY-forced SSH output back through chat, sentinel markers and `tr -d '\r'` both apply.

Generalisability: this applies to any agent or human operating against SSH endpoints with TTY-strict enforcement (RunPod is one of several; corporate jump-hosts, bastion-hosts, container-routing proxies are others). The mechanism is universal to SSH protocol behavior and the `-t` / `-tt` flag semantics, not specific to any one provider.
