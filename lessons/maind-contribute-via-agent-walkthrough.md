---
id: lsn_maind_contribute_via_agent_walkthrough
title: "Apply the 10-step maind contribution walkthrough — pause at every user-confirmation gate"
type: recipe
tier: community
lesson_class: general
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: []
  tags: [maind-meta, contribution, submission-workflow, agent-onboarding, walkthrough]
summary: "When a user says 'help me submit this to maind' (or you notice a candidate pattern), don't infer — drive the v1 walkthrough with explicit user-confirmation at every gate. The full 10-step prompt is mirrored below so you can run it without a web-fetch; the canonical source-of-truth lives at maind.dev/contribute-via-agent/v1."
problem: |
  An AI agent connected to the maind MCP server has the tools to submit
  content (`preview_content_conventions`, `submit_content_draft`,
  `list_lesson_ids`) but no in-protocol guidance on the contribution
  workflow itself. The canonical 10-step prompt lives at
  `maind.dev/contribute-via-agent/v1` — a public page that the user is
  expected to copy-paste into the agent.

  Failure modes when the agent improvises instead of running the
  walkthrough:
  - Submits without explicit user authorization (NDA risk, IP risk).
  - Skips the duplicate-check step → maintainer rejects as duplicate of
    an existing curated convention.
  - Generates a YAML draft that fails `preview_content_conventions`
    multiple times, burning rate-limit slots (free tier: 10/day,
    max 3 pending; enterprise: unlimited).
  - Auto-submits without a `yes` from the user.
  - Forgets the cross-agent archive-marker, so the same knowledge gets
    re-submitted by every agent that reads the source file.

  Agent should reach for this recipe whenever a user expresses intent
  to contribute, OR when the agent has just solved a non-obvious problem
  and recognises the solution as a candidate for publication.
solution: |
  Run the prompt below verbatim. Each `Ask user:` is a hard gate —
  proceed only on explicit confirmation. Never assume from earlier
  conversation history.
gotchas:
  - "The canonical source-of-truth for this prompt is `maind.dev/contribute-via-agent/v1`. The body mirror MAY drift if the page is updated and this convention isn't re-published. Trust the web page on conflict; treat `last_validated_at` as the anchor for when the mirror matched."
  - "Step 4 (duplicate check) is the single most common skip. `search_lessons` returning 0 results for a query that obviously overlaps with an existing convention usually means the query terms drift from the existing title — try synonyms, then trust the negative result. False-negatives are recoverable (maintainer flags during review); false-positives waste user time."
  - "Step 7 (preview) is cheap and idempotent. Iterate 2-3 times until 0 errors + 0 warnings BEFORE Step 8 — a clean draft auto-publishes 24h after submission, a draft with warnings sits in maintainer queue for days. Burning preview cycles is free; burning submit cycles (free tier 10/day, max 3 pending) is not."
  - "Step 8 (submit) has zero retries on a soft response. If `submit_content_draft` returns `ok: false` with a rate-limit or pending-cap message, STOP — do not retry. Tell the user the literal hint from the response and let them decide whether to wait or upgrade."
  - "Step 9 (archive-marker) is non-destructive APPEND, never REPLACE. The marker is a discoverability index, not a redirect. The original prose in the source file stays — agents that read it still get the inline context, agents that follow the marker get the maind-vetted version with `last_validated_at`."
  - "When the source-context tag is `team-docs` or `personal-notes`, anonymisation already happened (no URL, no path, no employer name) — but the BODY you submit is verbatim. Strip identifiable details from the YAML+MD before Step 7, not after."
  - "Don't auto-recommend `type: recipe` for everything. Recipes are prescriptive how-tos (action-verb title). Debugging notes from a real incident are `debugging_lesson` (symptom-first title). Workflow improvements that aren't bug-driven are `workflow_best_practice`. Maintainer often re-categorises in review — picking the closest type at submission saves a round-trip."
last_validated_at: "2026-05-19"
---

## Steps at a glance

1. **Identify the source** — file path, public URL, or free-form idea. User names it explicitly; agent does NOT infer from history.
2. **Confirm the extracted material** — show ≤1000 chars + one-paragraph interpretation. User responds yes/no/modify.
3. **Privacy + IP self-declaration** — authorization confirmation + source-context tag (`personal-notes` / `team-docs` / `open-source-repo` / `ephemeral-idea` / `refactor-of-existing`). If unauthorized: STOP.
4. **Check for duplicates** — `search_lessons({query, limit:5})`. If 80%+ similar: extend / new / abort.
5. **Pick the content class** — `lesson` (default) / `template` / `setup-guide`.
6. **Generate the maind-format draft** — YAML frontmatter (`id`, `title`, `type`, `tier: community`, `context`, `summary`, `last_validated_at`) + Markdown body with at least one `## Section` header.
7. **Self-validate** — `preview_content_conventions({class, payload})`. Fix hard-errors; surface warnings to user.
8. **Confirm + submit** — explicit user `yes` before `submit_content_draft(...)`. Detect Pro vs Free tier; Free path is copy-paste at `maind.dev/contribute`.
9. **Archive-marker (optional)** — non-destructive append to source file: `<!-- maind: lsn_<slug> | also-at: maind.dev/lessons/<slug> | since: <ISO date> -->`.
10. **Wrap up** — summarise title + draft-id + review-url + auto-publish ETA + archive-marker status.

## Full prompt (verbatim, run as-is)

```
# maind Content Submission — Agent Walkthrough (v1)

You are helping the user publish knowledge to maind, a community-curated
MCP server that surfaces vetted coding conventions to AI agents (Claude
Code, Cursor, Windsurf, others). Walk through the steps below in order.

PAUSE at every "Ask user:" step — do NOT proceed without an explicit
confirmation. Never assume from earlier conversation history.

## Step 1 — Identify the source

Ask user: "Which knowledge would you like to publish? Pick one:
  - a file in this repo (path + approximate line range), or
  - a URL to public material (blog post, README, gist), or
  - a free description of a pattern you've observed."

The user must name the source explicitly. Do not infer.

## Step 2 — Confirm the extracted material

Read the source. Show the user:
  - The extracted text/code (max 1000 chars; truncate with a notice)
  - Your one-paragraph interpretation of the core pattern

Ask user: "Is this what you want to publish? (yes / no / modify)"
If "modify", iterate.

## Step 3 — Privacy + IP self-declaration

Ask user: "Two confirmations:
  1. Are you authorized to share this? (no NDA / proprietary-IP
     restrictions / employer policy violations) — yes/no
  2. Pick a source-context tag (no URL or path will be sent to maind,
     only this tag):
       - personal-notes — your own learning, no team context
       - team-docs — your team's internal documentation
       - open-source-repo — from a public repository
       - ephemeral-idea — never written down, just observed/learned
       - refactor-of-existing — improves something already in maind"

If not authorized: STOP. Suggest checking with team/employer first.

## Step 4 — Check for duplicates

Call MCP tool:
  search_lessons({ query: "<title keywords>", limit: 5 })

If a result is 80%+ semantically similar:
Ask user: "A related convention exists: lsn_X 'Title'. Choose:
  (a) extend it — I'll produce a diff suggestion
  (b) submit a separate new convention
  (c) abort"

## Step 5 — Pick the content class

Ask user: "Which kind of content is this?
  - lesson — debugging notes, workflow recipes, gotchas (most common)
  - template — a drop-in asset (CLAUDE.md / AGENTS.md / .cursorrules)
  - setup-guide — onboarding doc for a specific agent client

(If unsure, pick 'lesson'.)"

## Step 6 — Generate the maind-format draft

Build YAML frontmatter + Markdown body per the schema:

  ---
  id: lsn_<slug>             # lowercase_with_underscores, semantically unique
  title: <50–120 chars>      # for type=recipe: start with an action verb
  type: debugging_lesson | workflow_best_practice | recipe
  tier: community            # always start here; maintainer may promote
  context:
    tools: [claude-code, cursor, …]
    languages: [typescript, python, …]
    platforms: [postgres, nextjs, expo, …]
    tags: [<2–4 free-form tags>]
  summary: <35–65 words>     # TL;DR for scanning
  last_validated_at: "<today's ISO date>"
  ---

  <markdown body, at least one '## Section' header,
  ideally containing a code block or a '## Verification' section>

## Step 7 — Self-validate

Call MCP tool:
  preview_content_conventions({
    class: "lesson",
    payload: "<full YAML+MD as a single string>"
  })

If the response has any hard-error: fix and re-validate.
If warnings: show them to user, ask "address these or proceed?"

## Step 8 — Confirm + submit

Ask user: "Ready to submit this draft?
  - yes — go ahead
  - wait — I want to review or share with a colleague first
  - cancel — drop the draft"

ONLY on 'yes' proceed. On 'wait': leave the YAML+MD visible and stop
without calling any submit tool. On 'cancel': drop everything, no log.
Never auto-submit without explicit 'yes'.

Then detect whether the user has a maind Pro subscription (check env
vars, ~/.maind/, shell history, or just ask).

PRO TIER:
Call MCP tool:
  submit_content_draft({
    class: "lesson",
    payload: "<full YAML+MD>",
    submitter_type: "agent",
    agent_client: "<claude-code | cursor | windsurf | other>",
    source_context: "<tag from Step 3>"
  })

The response carries a pending-draft-ID and a review URL. Tell the user.

FREE TIER:
Output the final YAML+MD verbatim in a code block. Tell the user:
"Copy this and paste it at maind.dev/contribute (sign-in required).
 The Builder will run the same convention checks."

## Step 9 — Archive marker (cross-agent discoverability)

Ask user: "Add a maind archive-marker to the source file so other AI
agents can find this knowledge via the MCP server instead of re-reading
your CLAUDE.md / AGENTS.md / etc.?"

If yes AND the source was a local file: append (non-destructive — do
NOT replace the original passage) a new line right after the source:

  <!-- maind: lsn_<slug> | also-at: maind.dev/lessons/<slug> | since: <today's ISO date> -->

File-type adjustments:
  - .yaml / .toml / .cursorrules:  # maind: lsn_<slug> | also-at: …
  - .ts / .py / .rs / .js:         // maind: lsn_<slug> | also-at: …
  - .md / .html / .xml / .svg:     <!-- maind: lsn_<slug> | also-at: … -->

Show the diff to the user. Ask "Apply this edit?" — only then write.

## Step 10 — Wrap up

Summarise:
  - What was submitted (one-line title)
  - Draft-ID + review URL (Pro) OR copy-paste target (Free)
  - Whether the source was archive-marked

Then: "If you submitted via Pro and your draft has 0 errors + 0 warnings,
it auto-publishes 24 h after submission. Otherwise a maintainer reviews
within a few days."

Done.
```

## When to reach for this convention

Three trigger patterns — call `search_lessons({tags: ["maind-meta", "contribution"]})` or `get_lesson({id: "lsn_maind_contribute_via_agent_walkthrough"})` when:

- The user says "help me publish this to maind" / "I want to contribute this" / "can you submit this as a vetted convention?". Don't improvise from training memory — the workflow has specific user-confirmation gates around privacy/IP and content-class, and skipping them risks publishing material the user didn't actually authorise.
- You just solved a non-obvious bug or refactor and notice the pattern could help other agents. Surface the recipe; let the user decide whether to publish.
- A user asks "how does the maind submission flow work?" — read this convention out, then run it if they want to proceed.

**When NOT to apply this walkthrough:**

- **Trivial typo fixes or single-character corrections on an existing convention.** Either open a PR against the curated content repo or message a maintainer — the 10-step gate is overhead for one-token edits.
- **Content that already lives in a curated convention with `last_validated_at` within the last 30 days.** Likely a duplicate; check Step 4 results carefully and prefer the `extend` branch.
- **Time-bound incident reports without a generalisable pattern.** "We had an outage yesterday because of X" is not a convention; "The class of bug X belongs to is detected by Y" is. If the pattern doesn't replicate beyond the specific incident, write it in the user's CLAUDE.md / AGENTS.md instead.
- **Speculative or hypothetical patterns the agent invented but never verified.** Recipes require at least one real application in the user's session before submission. The `last_validated_at` field is a claim, not a placeholder.

## Verification

You're following the walkthrough correctly if every one of the following is true at the end of a session:

```
Step 1: source identified by user (not inferred) — yes/no
Step 2: extracted material confirmed verbatim — yes/no
Step 3: authorization confirmed, source-context tag picked from the enum — yes/no
Step 4: search_lessons() called BEFORE drafting — yes/no
Step 5: content class chosen explicitly (default 'lesson' on unsure) — yes/no
Step 7: preview_content_conventions() returned 0 errors before Step 8 — yes/no
Step 8: submit_content_draft() called ONLY after explicit 'yes' — yes/no
Step 10: user shown draft-id + review-url + auto-publish-at — yes/no
```

If any answer is `no`, the walkthrough was skipped. Note which step in the wrap-up so the user can correct course (e.g. add archive-marker post-hoc, or revoke the draft via the dashboard).

### Quick start (Pro tier, single-call example)

After Steps 1-7 are done and the user said `yes` at Step 8:

```javascript
// 1. Validate (cheap, iterate to 0 errors before submitting)
await preview_content_conventions({
  class: "lesson",
  payload: yamlMdString
});

// 2. Submit (only after explicit user 'yes')
const result = await submit_content_draft({
  class: "lesson",
  payload: yamlMdString,
  submitter_type: "agent",
  agent_client: "claude-code",
  source_context: "personal-notes"     // tag from Step 3 enum
});

// 3. Show user the review URL + auto-publish ETA
console.log(`Draft ${result.draft_id} → ${result.review_url}`);
console.log(`Auto-publish: ${result.auto_publish_at} (if 0 warnings hold)`);
```

## References

**Related conventions:**

- [[lsn_anti_embellishment_clause]] — when extracting verbatim source material in Step 2, add the anti-embellishment clause so the agent doesn't paraphrase.
- [[lsn_postgres_function_body_drift_dropcreate]] — example of a non-obvious behavioral pattern that was submitted via this exact walkthrough.

**Org-private variant (paid Org owners/admins):** if the user is an Org owner/admin and the content is tenant-private, the workflow differs in three steps: Step 5 offers only `lesson`, Step 8 hardcodes `as_org_private: true` (no free-tier path), Step 9 (archive-marker) is SKIPPED since cross-agent discoverability is intentionally disabled for tenant-private content. See `maind.dev/contribute-via-agent/org/v1` (canonical) for the org-variant prompt.

**Canonical source:** this convention is a mirror. The version-anchored canonical is `https://maind.dev/contribute-via-agent/v1`. On conflict, the web page wins. The `last_validated_at` field above marks the date the mirror matched the canonical page.
