---
id: lsn_new_repo_setup_baseline
title: New-repo baseline — gitignore, conventional commits, branch strategy, hosting choice, remote setup
type: workflow_best_practice
tier: community
summary: At git-init, lock down a baseline that costs minutes now and saves hours later — stack-appropriate gitignore including cloud-sync patterns, conventional commits + an explicit branch strategy, a deliberate hosting-provider pick, and SSH-first remote setup. Skipping the baseline is what turns "5-minute setup" into multi-day cleanup.
context:
  tools: [claude-code, cursor, windsurf]
  languages: []
  platforms: []
  tags:
    - new-repo
    - gitignore
    - conventional-commits
    - branch-strategy
    - hosting
last_validated_at: "2026-05-21"
---

## When this triggers (and when it doesn't)

- Every `git init` for a codebase intended to outlive a single afternoon.
- Adoption of a legacy repo missing baseline artifacts (no gitignore,
  no LICENSE, no conventional-commits doc, no branch-strategy doc).
- Repository promotion from private to public — last chance to land the
  baseline before external eyes see the history.

**When this does NOT apply:**

- Throwaway prototypes / spike repos with a planned lifetime under
  ~2 weeks. The baseline overhead doesn't amortize.
- Forks of mature upstreams — inherit the upstream's baseline; only
  add what's missing.
- Single-file gists or "code as documentation" snippets.

## gitignore baseline (stack-appropriate + cloud-sync defenses)

Start from a stack template (gitignore.io or the github/gitignore
template repo) — these cover language- / framework-specific files.
Then layer in defenses that templates rarely include:

- **Cloud-sync artifacts** (when the repo lives in iCloud, OneDrive,
  Dropbox, Google Drive): `.DS_Store`, `Icon?`, `* 2.*`, `*.icloud`.
  Cloud-sync rename-on-conflict patterns like `<file> 2.<ext>`
  silently double files and break module resolution.
- **Package-manager caches**: `node_modules/`, `.pnpm-store/`,
  `__pycache__/`, `target/`, `.gradle/`, `vendor/`. These are
  regeneratable; never commit them.
- **Build artifacts**: `dist/`, `build/`, `.next/`, `out/`,
  `coverage/`, `*.tsbuildinfo`.
- **Env / secrets**: `.env*` except `.env.example`, `*.pem`,
  `*.key`, `id_rsa*`.
- **Config files that hold tokens**: `.mcp.json`, `.fly/`,
  `.vercel/`. Pre-check before writing a token per
  [[lsn_mcp_json_token_leak_pre_check]] — `.gitignore` does NOT
  untrack files already in the index.

Commit the baseline gitignore as part of the **initial commit**, not
later — once a file is tracked, gitignore won't untrack it.

## Conventional Commits + branch strategy

Document both in `CONTRIBUTING.md` (or `README.md` if no separate
contrib doc). A minimal skeleton:

- **Commit types**: `feat` / `fix` / `chore` / `docs` / `refactor` / `test`
  / `perf` / `style`. Subject ≤72 chars, imperative mood
  (`add` not `added`), no trailing period. Body for non-trivial
  changes explains WHY.
- **Branch strategy** — pick one and document:
  - **Trunk-based**: solo or small co-located team; everyone commits
    to `main`; feature branches lifetime ≤ 2 days.
  - **GitHub Flow**: every change is a PR against `main`; main is
    always deployable; default for open-source.
  - **GitLab Flow**: trunk + environment branches (`production`,
    `staging`) for explicit deploy gates.
  - **git-flow** (Vincent Driessen): heavy ceremony — only justify
    when you have a real release-train discipline; rarely the right
    call in 2026.

## Hosting choice + remote setup

Provider comparison (the choice is rarely reversible without history
rewrite + tool re-integration, so make it deliberately):

| Provider | Pros | Cons | Sweet-spot |
|---|---|---|---|
| GitHub | Network-effect, Actions, IDE integrations, Copilot | Vendor lock, Microsoft-owned | Open-source, max visibility |
| GitLab (SaaS or self-host) | Built-in CI, mature self-host story | Denser UI, smaller marketplace | Compliance shops, enterprise |
| Bitbucket | Jira/Confluence integration | Shrinking mindshare | Atlassian stacks |
| Codeberg (Forgejo-based, non-profit) | EU-based, community-governed | Smaller ecosystem | Indie devs, EU data residency |
| Forgejo / Gitea (self-hosted) | Full control, AGPL | Maintenance burden | Sovereignty-focused setups |
| sourcehut | CLI-first, no JS UI required | Steep learning curve | Mailing-list workflow fans |

Remote-connection patterns once the provider is picked:

- **SSH over HTTPS + token** as the default. SSH keys are stable;
  HTTPS tokens rotate and re-prompt.
- **Per-provider SSH-config stanzas** when you keep accounts on
  multiple providers:

  ```
  # ~/.ssh/config
  Host github.com
    IdentityFile ~/.ssh/id_ed25519_github
  Host gitlab.com
    IdentityFile ~/.ssh/id_ed25519_gitlab
  ```

- **GitHub Fine-Grained PAT scoping** — owner-bound, see
  [[lsn_github_fine_grained_pat_per_owner]] when one PAT can't
  reach all the repos you expected.
- **First push** after the initial commit, not before — pushing an
  empty `main` and then squashing later is messier than committing
  the baseline first and pushing once.

## Anti-patterns

- Initial commit containing `node_modules/` or build artifacts.
  Removing them later still leaves them in the git history forever.
- Remote push before LICENSE — public repo without explicit license
  defaults to maximum restriction. See [[lsn_project_license_choice]].
- "We'll pick a hosting provider later" — SSH keys, CI templates,
  hook paths are provider-specific; switching mid-way means migration.
- Conventional Commits "kinda" — `feat: stuff` and `update` mix;
  tooling (`semantic-release`, `changelog-generator`) breaks silently
  on the malformed commits.
- Branch strategy unspoken — first external contributor opens a PR
  against the wrong branch; you spend the review on protocol instead
  of the code.

## Sample maind tool calls

```
# When entering an unfamiliar repo, audit the baseline:
audit_repo_aireadiness({
  repo_snapshot: { file_listing: [...], has_adr_dir: ..., detected_agent_files: [...] }
})

# When the user asks "how should I set up X for my new repo?":
search_lessons({
  query: "new repo setup gitignore branch strategy hosting",
  limit: 5
})
```

Cross-refs: [[conv_repo_readiness_baseline]] (the always-on convention),
[[lsn_project_license_choice]] (the LICENSE half of new-repo setup),
[[lsn_mcp_json_token_leak_pre_check]] (gitignore vs tracked files),
[[lsn_github_fine_grained_pat_per_owner]] (PAT scoping),
[[lsn_cross_project_sync_script_pattern]] (multi-repo workspace).
