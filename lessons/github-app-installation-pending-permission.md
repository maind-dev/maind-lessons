---
id: lsn_github_app_installation_pending_permission
title: '403 "Resource not accessible by integration": a GitHub App permission stays pending until an org owner accepts it'
type: debugging_lesson
tier: community
context:
  tools:
    - gh
  languages: []
  platforms:
    - github
  tags:
    - github
    - github-app
    - permissions
    - octokit
    - authentication
summary: "Adding a permission to a GitHub App's manifest does NOT grant it to existing installations. Each installation keeps its last-accepted scope until an org owner approves the pending request, and the installation access token is minted with the OLD set. The call needing the new permission then returns 403 'Resource not accessible by integration', while older-scope calls keep working."
last_validated_at: "2026-05-30"
---
# Background

A GitHub App has two permission layers that drift apart:

- **App manifest (declared):** what the App *requests*. Public via `gh api /apps/<app-slug>` → `.permissions`.
- **Installation (granted):** what a given org/account installation has actually *accepted*. Via `gh api /orgs/<org>/installations` → each installation's `.permissions`.

Adding a permission to the App (e.g. `pull_requests: write`) does NOT propagate to existing installations. GitHub raises a *pending* permission request that an **org owner must approve** in the org's GitHub-App settings. Until then, `@octokit/auth-app` mints the installation token with the **old** granted set.

# Symptom

Everything the App could do before still works, but the one call needing the new permission fails:

```
POST /repos/<owner>/<repo>/pulls  →  403 "Resource not accessible by integration"
```

That exact 403 is a GitHub-App **installation-token** error. It means the integration lacks the *permission* for that resource — not that the App is uninstalled (that would be 404).

# Diagnosis: the declared-vs-granted gap

```bash
# DECLARED (manifest):
gh api /apps/<app-slug> --jq '.permissions'
# -> {"contents":"write","metadata":"read","pull_requests":"write"}

# GRANTED (installation):
gh api /orgs/<org>/installations \
  --jq '.installations[]|select(.app_slug=="<app-slug>").permissions'
# -> {"contents":"write","metadata":"read"}   # pull_requests MISSING
```

If the manifest lists a permission the installation's set lacks, it is pending acceptance.

## Forensic tell

A partially-permitted token gets halfway through a multi-call flow. Opening a PR is blob → tree → commit → ref → pulls.create. With `contents:write` but no `pull_requests`, the first four succeed and only `pulls.create` 403s, leaving **orphan branches with no PR**. Branches that exist but have no associated PR are a strong signal that the write-permission was accepted but the PR-permission was not.

# Fix

An org owner opens the org's Settings → GitHub Apps → the App → Configure, and reviews + accepts the pending permission. There is no clean REST endpoint — it is a UI approval. Then re-check the granted set:

```bash
gh api /orgs/<org>/installations \
  --jq '.installations[]|select(.app_slug=="<app-slug>").permissions'   # now includes the new scope
```

Installation tokens are short-lived (~1h) and cached by `@octokit/auth-app`; a warm server may hold an old-scope token until it refreshes. If the first retry still 403s, wait for the next token mint.

# Generalization

"Permission is in the App manifest" reads as done, but the manifest is a request, not a grant. The same gap applies to webhook event subscriptions: subscribing a GitHub App to a new event can also need installation re-acceptance. Treat "added a permission or event to a GitHub App" as incomplete until you verify the granted set on the installation.

# When this does NOT apply

- A **404** (not 403) points the other way: the App is not installed on that repo, or a Fine-Grained PAT is owner-scoped wrong — see [[lsn_github_fine_grained_pat_per_owner]].
- A Fine-Grained **PAT** or the Actions `GITHUB_TOKEN` hitting a permission wall returns a *different* message — this lesson is specifically about a **GitHub-App installation** token.

```
search_lessons({ query: "github app installation permission 403 resource not accessible", platforms: ["github"] })
```
