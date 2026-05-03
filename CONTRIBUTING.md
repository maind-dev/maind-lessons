# Contributing a lesson

Thank you for considering a contribution. The bar is "specific and reproducible";
everything else is style.

## Format

A lesson is one Markdown file under `lessons/`, named `NNNN-short-slug.md`.

```markdown
---
id: lsn_0042_my_lesson_slug
title: One-line lesson title (max 200 chars)
type: debugging_lesson    # or: workflow_best_practice
tier: community           # always start here; maintainer may promote later
context:
  tools: [claude-code]
  languages: [typescript]
  platforms: [macos]
  tags: [performance, mcp]
summary: One-sentence TL;DR (max 500 chars).
problem: |
  What you observed. Symptoms, environment, version numbers.
solution: |
  What actually fixed it. Numbered steps preferred.
gotchas:
  - "A common misleading 'fix' that does not actually help."
evidence: "Link, citation, or measurement that backs the claim."
last_validated_at: "2026-05-01"
tool_versions:
  claude-code: "1.4.2"
---

Optional longer prose body. This is what the agent reads in full.
Keep it tight — assume the reader is another AI agent in a hurry.
```

### Field reference

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Format `lsn_NNNN_snake_case_slug`, must be unique. |
| `title` | yes | 1–200 chars, no trailing period. |
| `type` | yes | `debugging_lesson` or `workflow_best_practice`. |
| `tier` | yes | `community` for all PRs. Maintainers promote to `curated` separately. |
| `context.tools` | recommended | e.g. `[claude-code, claude-desktop, cursor, codex]`. Lowercase. |
| `context.languages` | recommended | e.g. `[typescript, python]`. |
| `context.platforms` | recommended | e.g. `[macos, linux, windows]`. |
| `context.tags` | optional | Free-form lowercase. Reuse existing tags when possible. |
| `summary` | yes | 1–500 chars. The TL;DR shown in agent search results. |
| `problem` | recommended | Describe the symptom from the user's POV. |
| `solution` | recommended | Numbered steps. The actually-helpful action. |
| `gotchas` | optional | List of common false fixes. |
| `evidence` | recommended | Link, citation, or measurement. |
| `last_validated_at` | recommended | ISO date `YYYY-MM-DD` of the last time you reproduced this. |
| `tool_versions` | optional | Map of tool → version string. |
| `upvotes` | leave out | Maintained by the system, not by contributors. |
| Body | yes | Free Markdown. The full text the agent reads. |

## Workflow

1. **Fork** this repo and clone your fork.
2. **Pick the next ID.** Run `ls lessons/` and pick the next free `NNNN`.
3. **Write the lesson.** Use a recent existing lesson as a template.
4. **Validate locally:** `pnpm install && pnpm validate`.
   This runs the same checks as the GitHub Action — frontmatter validity,
   schema conformance, plus a prompt-injection / destructive-pattern scan
   on the body.
5. **Sign off your commits.** Use `git commit -s` on every commit. This
   appends a `Signed-off-by:` trailer that attests the
   [Developer Certificate of Origin](https://developercertificate.org/) —
   in plain words: "I wrote this, or I have the right to submit it under
   the project's licenses (MIT for tooling, CC BY-SA 4.0 for content)."
   CI rejects PRs with unsigned commits. Existing commits without the
   trailer can be retroactively signed with `git rebase --signoff main`.
6. **Open a PR.** In the description, briefly say what made you write this
   lesson — a real bug you hit, a workflow you want documented, etc.
7. **Address review.** A maintainer will check: does it reproduce, is it
   specific, is the tier right.
8. **Merge.** Your lesson goes live with the next MCP-server deploy
   (typically within 24h).

## Quality bar — what gets rejected

- **Vague advice.** "Restart your editor" without a precise trigger / version
  / observable symptom is not a lesson.
- **Re-stating documentation.** If the official docs cover it cleanly, link
  to them in `evidence`; don't paste them in.
- **Marketing or opinion.** Lessons are operational. "Tool X is better than
  tool Y" doesn't fit.
- **Mass submissions.** Quality > quantity. Bundling 10 thin lessons into
  one PR will be asked to be split and reviewed individually; we'd rather
  one strong lesson.

## Trust

Community-tier lessons are surfaced with an explicit "verify before acting"
trust marker so that agents don't execute destructive operations blindly. If
your lesson involves anything destructive (file deletions, schema changes,
production deploys), call that out in the body — the trust marker is there
to remind agents, but a clear warning in the lesson itself is better.

## License of your contribution

By opening a PR you agree your contribution is licensed:

- **Lesson content** under [`lessons/`](./lessons/) — Creative Commons
  BY-SA 4.0 (see [`LICENSE-CONTENT`](./LICENSE-CONTENT)).
- **Tooling changes** (anywhere outside `lessons/`) — MIT (see
  [`LICENSE`](./LICENSE)).

The `Signed-off-by:` trailer in your commits is the legally operative act of
agreement. The maintainer team does not require a separate CLA signature.

## Promotion to curated

Maintainers may copy a community lesson into the proprietary
`maind-lessons-curated` repository (visible to paid plans), redact and
restructure it as appropriate, and assign a new `lsn_NNNN_*` id. The curated
version retains an `attribution` frontmatter block:

```yaml
attribution:
  based_on: lsn_NNNN_<original_id>
  original_author: "<your handle>"
  original_repo: maind-lessons
  original_commit: "<sha>"
```

Your original lesson here remains under CC BY-SA 4.0 and is not removed by
promotion.

## Questions

Open a draft PR and ask in the description, or reach out at
`support@maind.dev`. Code of Conduct issues: `conduct@maind.dev`.
