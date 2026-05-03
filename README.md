# maind-lessons (template)

> **Status:** template living in the monorepo until the standalone repo is created.
> The plan: copy the contents of this directory into a new public repo
> `github.com/maind-dev/maind-lessons`. Until then, lessons keep shipping from
> `apps/ai-lessons-mcp/data/lessons/`. See `lesson-submission-workflow.md` in the
> Asgard Obsidian Vault for the migration plan and the cutover steps.

A community-maintained library of debugging lessons and workflow notes for AI
coding agents. Surfaced to agents at runtime via the
[maind MCP server](https://maind.dev).

## What goes in here

A *lesson* is one Markdown file describing a concrete situation an AI agent
might face, the symptoms, what actually fixes it, and what false fixes to
avoid.

- **Reproducible** — the next reader can recreate the situation.
- **Specific** — names tools, versions, exact symptoms.
- **Bounded** — one symptom, one fix. If you have a tutorial, link it instead.

Lessons are not how-to guides, marketing posts, or stack-overflow links.

## How to contribute

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full format spec.

In short:

1. Fork this repo.
2. Add a file under `lessons/`. Pick the next free `NNNN-` number.
3. Run `pnpm validate` (or `node scripts/validate.mjs`) — same checks as CI.
4. Open a pull request describing the situation that prompted the lesson.

CI validates frontmatter; a maintainer reviews; on merge the lesson ships
with the next MCP-server deploy.

## Tiers

- `community` — user-submitted, agent surfaces with a "verify before acting"
  trust note. **All PRs default to this.**
- `curated` — reviewed and reproduced by maintainers. Reserved for lessons
  promoted after merge by a maintainer in a follow-up PR.

## License

Dual-licensed (see ADR-037 in the maind workspace):

- **Tooling** (`scripts/`, `schema/`, `.github/workflows/`, root config) — MIT.
  See [`LICENSE`](./LICENSE).
- **Lesson content** (`lessons/`) — Creative Commons BY-SA 4.0. See
  [`LICENSE-CONTENT`](./LICENSE-CONTENT).

By opening a PR you agree your contribution is licensed under those terms.
Each commit must carry a `Signed-off-by:` trailer attesting the
[Developer Certificate of Origin](https://developercertificate.org/) — use
`git commit -s`. CI enforces this.

## Promotion to curated tier

Maintainers may select community lessons for editorial revision into the
proprietary `maind-lessons-curated` repository (the curated tier visible to
paid plans). The original community lesson stays in this repository under
CC BY-SA 4.0; the redacted curated version retains an `attribution`
frontmatter block crediting the original author.

## Code of Conduct

Participation in this project is governed by the
[Contributor Covenant 2.1](./CODE_OF_CONDUCT.md). Reports go to
`conduct@maind.dev`.
