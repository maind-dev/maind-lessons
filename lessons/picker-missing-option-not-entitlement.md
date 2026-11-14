---
id: lsn_picker_missing_option_not_entitlement
title: Diagnose an option missing from a picker — test the direct path before suspecting access, version or account
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools:
    - claude-code
    - vscode
  languages: []
  platforms:
    - macos
  tags:
    - diagnosis-order
    - model-picker
    - server-driven-ui
    - cache
    - ide-extension
    - verification
summary: >-
  An option missing from a dropdown is usually a list bug, not an access
  gap. Pickers merge a built-in list, a cached server-delivered list,
  settings rows and the active value. Select the option by its id first;
  if that works, read the list's sources and add the row via the
  documented setting instead of editing a cache.
last_validated_at: "2026-11-13"
---

## Symptom

An option the user is entitled to does not appear in a picker. In the
incident behind this entry: a newly released model was selectable on the
vendor's web app and listed in the CLI's changelog, yet the IDE extension's
model dropdown showed only its predecessor. Two side observations made it
look like an account problem:

- Selecting the model by id worked, but the confirmation said the choice
  applied **for this session only**; other and new sessions stayed on the old
  model.
- In one session the new model *did* appear in the dropdown — the one where
  it had just been selected by id — which read as "the fresh login unlocked
  it in this window only".

The diagnosis then went through account, plan, client version and login
before landing on the cause. Two commands at the start would have settled it.

## Root cause pattern

A picker is rarely one list. Typical sources, merged at render time:

| Source | Where it lives | Fails how |
|---|---|---|
| Built-in lineup | shipped with the client version | stale if the client is old |
| Server-delivered extras | fetched per account, **cached locally** | server omits a row → absent everywhere, no error |
| Settings-defined rows | user / managed settings | absent until configured |
| Current value | session state | shown as an extra row only while active |

The last row explains the "visible in one session only" illusion: many
pickers append the active value when it is not otherwise listed. And the
"session only" message is usually just the difference between a slash/CLI
switch (session-scoped) and a picker selection (saved as default) — not a
sign of restricted access.

Access is enforced server-side per request. A row in a list neither grants nor
proves entitlement, so "missing row" and "no access" are separate questions.

## Diagnosis order

1. **Direct path.** Select the option by its id (`/model <id>`,
   `--model <id>`, a config key). If it works, entitlement is fine — the
   problem is the list.
2. **Which client is actually running?** Forked or rebranded editors keep
   extensions in their own directory; the standard one may hold an older,
   unused copy. Read the path from the live process instead of assuming:
   ```bash
   ps aux | grep -o '<publisher>.<extension>-[0-9.]*[^ /]*' | sort -u
   ls -d ~/.*/extensions/<publisher>.<extension>-*
   ```
3. **Does that version know the option?** Changelog, or
   `strings <binary> | grep -c <option-id>`.
4. **What does the server deliver?** Find the local cache of the
   server-driven list and read it — if the row is absent there, no client
   change will make it appear.
5. **Local restrictions** — allowlists, env overrides, managed/admin
   settings.
6. **Upstream issues.** Search the vendor's tracker for the exact symptom;
   a known bug turns guessing into waiting plus a workaround.
7. **Workaround via the documented setting** that adds picker rows (for
   Claude Code: `modelPicker.options` in user settings). Do not hand-edit the
   cache — it is overwritten on the next refresh, and a settings row is easy
   to find and remove once upstream fixes the list.

## Example (Claude Code, Nov 2026)

```json
"modelPicker": {
  "options": [{ "model": "claude-fable-5-2", "label": "Fable 5.2" }]
}
```

Rows are appended to the built-in lineup unless `replaceBuiltInOptions` is
true. Remove the block once the server list contains the model, or it will
appear twice.

## When this does NOT apply

- **The direct path fails** with an access or plan error — then it really is
  entitlement; check plan, org policy and rollout status.
- **The picker is a pure client-side enum** with no server or settings input —
  then the client version is the whole story; update it.
- **Admin-managed allowlists** (`availableModels` or equivalent) hide the
  option on purpose; a user-level row will not override policy and should not
  try to.

## Related

- [[lsn_macos_open_foregrounds_existing_instance]] — verify which instance is
  actually running before trusting what you see.
- [[lsn_worktree_gitignored_config_wrong_target]] — let the target identify
  itself instead of inferring it from where you think you are.

```
search_lessons({ query: "option missing from picker dropdown server list cache entitlement" })
```
