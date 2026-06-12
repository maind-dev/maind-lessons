---
id: lsn_raw_keypress_unbuffered_os_read
title: "Fix arrow keys misread as ESC in a raw-mode TUI: read the fd with os.read(), not buffered sys.stdin.read()"
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools: []
  languages: [python]
  platforms: [macos, linux]
  tags: [terminal, tty, raw-mode, cli, arrow-keys, escape-sequences, stdin-buffering]
summary: "In a raw-mode keypress reader, sys.stdin.read(1) pulls the rest of an escape sequence into Python's TextIOWrapper buffer, where select() — which only inspects the OS fd — can't see it, so arrow keys get misread as a bare ESC. Read the fd directly with os.read(fd, n), paired with select() on the integer fd."
gotchas:
  - "select() on sys.stdin (or its .fileno()) reports nothing-to-read even when the arrow's trailing bytes sit in Python's userspace buffer — they already left the OS fd."
  - "It compiles and looks right; Enter and single-byte keys work, only multi-byte escape sequences (arrows / Home / End / F-keys) break — so it passes a quick smoke test."
  - "Keep tty.setraw() active only for the single read and render in cooked mode, otherwise \\n carries no implicit \\r and the menu stair-steps."
  - "A bare ESC has no follow-up bytes — disambiguate with a short (50-100 ms) select() timeout AFTER switching to os.read, not before."
last_validated_at: "2026-06-11"
---
## Symptom

You build an arrow-key menu in a terminal using raw mode (`termios` / `tty`).
Enter works, typing works, but the **arrow keys do nothing** — or worse, an
arrow press is interpreted as "cancel". The code compiles cleanly and the
escape-sequence decoding logic looks correct.

## Root cause

`sys.stdin` is a buffered `TextIOWrapper`. The first `sys.stdin.read(1)` makes
the wrapper pull *all currently-available bytes* from the OS file descriptor
into its **userspace buffer**, decode one character, and return it — leaving
the rest in the buffer.

An arrow key sends three bytes atomically: `ESC [ A` (`\x1b[A`). So:

1. `ch = sys.stdin.read(1)` returns `"\x1b"` and silently buffers `"[A"`.
2. You call `select.select([sys.stdin], [], [], 0.05)` to check for follow-up
   bytes — but `select()` inspects the **OS fd**, which is now empty; the `[A`
   is in Python's buffer, invisible to `select()`.
3. `select()` reports "nothing ready" → your code concludes "bare ESC" →
   cancel / no-op. The arrow is lost.

This is why Enter (a single `\r`) and plain letters work but arrows don't:
only multi-byte escape sequences span the buffer boundary.

## Fix: read the file descriptor directly with os.read

`os.read(fd, n)` bypasses the TextIOWrapper buffer, so `select()` and the byte
stream stay in sync.

```python
import os, sys, termios, tty, select

def read_key():
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        b = os.read(fd, 1)                 # UNBUFFERED — not sys.stdin.read()
        if not b:
            return "eof"
        if b == b"\x1b":                   # ESC: arrow sequence or bare ESC
            if select.select([fd], [], [], 0.1)[0]:
                rest = os.read(fd, 2)
                return {b"[A": "up", b"[B": "down",
                        b"[C": "right", b"[D": "left"}.get(rest, "esc")
            return "esc"                   # bare ESC (no follow-up bytes)
        if b in (b"\r", b"\n"):
            return "enter"
        return b.decode("utf-8", "ignore")
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
```

Key points:

- `select([fd], ...)` on the **integer fd**, paired with `os.read(fd, ...)`.
  Never mix `select()` with `sys.stdin.read()`.
- Keep raw mode active only for the single read; render the menu in cooked
  mode so `\n` still maps to `\r\n` (otherwise lines stair-step).
- The 50–100 ms `select()` window disambiguates a bare ESC (cancel) from an
  arrow's `[A`. Locally the follow-up bytes arrive together, so even a short
  window works; 100 ms adds slack for SSH / IDE-terminal latency.

## A more portable fallback: type-to-select

A plain-byte keystroke (a letter) is immune to this bug — it's a single
`os.read` with no escape decoding. So in a flaky terminal, **typing the option
name is more portable than arrows**: offer both. Accumulate typed letters into
a query string and jump the highlight to the first matching option; confirm
with Enter. Even where arrows misbehave, typing still works.

## When this does not apply

- You're using a higher-level library (`curses`, `prompt_toolkit`, `blessed`,
  `readchar`) — they own the fd reads and escape decoding; don't hand-roll
  `termios` underneath them.
- You only need line-at-a-time input (`input()` in cooked mode) — there is no
  raw mode and no escape-sequence boundary to cross.
- Windows: there is no `termios`; use `msvcrt.getwch()`, which returns arrow
  keys as a two-call prefix sequence (`\x00` / `\xe0` then a code) rather than
  ANSI escapes.

## Verification

To exercise the arrow path itself, drive the program through a PTY and feed
`b"\x1b[B"`. With the buffered-read bug the highlight won't move (the arrow is
swallowed); with the `os.read` fix it moves down. Note that injecting keys into
a PTY master can raise EIO on some macOS setups — verifying in a real terminal
is the reliable check.