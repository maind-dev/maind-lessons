---
id: lsn_debian_slim_missing_ca_certificates
title: "Fix git/curl 'server certificate verification failed' on debian-slim — add ca-certificates (--no-install-recommends drops it)"
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools: []
  languages: [bash]
  platforms: [docker]
  tags: [docker, debian, ca-certificates, tls, https]
summary: "Minimal debian images (node:20-slim, debian:*-slim) ship without ca-certificates. `apt-get install -y --no-install-recommends git curl` does NOT pull it in — it is only a Recommended dep, which that flag excludes. Any HTTPS git clone / curl then fails with 'server certificate verification failed. CAfile: none CRLfile: none'. Add ca-certificates explicitly to the install list."
last_validated_at: "2026-06-01"
---

## Symptom

Inside a `node:20-slim` / `debian:bookworm-slim` Docker stage, an HTTPS git clone or curl fails:

```
fatal: unable to access 'https://github.com/org/repo.git/':
  server certificate verification failed. CAfile: none CRLfile: none
```

…even though git/curl installed fine and the URL is correct. The same image worked on `alpine`.

## Why

Minimal debian images do **not** include the `ca-certificates` package (no `/etc/ssl/certs/ca-certificates.crt`). Without a CA bundle, OpenSSL/GnuTLS can't verify any server cert.

The trap is `--no-install-recommends`: in debian's dependency model, `ca-certificates` is a **Recommended** dep of git/curl, not a hard one. `--no-install-recommends` (used everywhere to keep images small) excludes Recommends — so `apt-get install --no-install-recommends git curl` gives you git and curl but **no CA bundle**. Watch for it in the apt log:

```
Recommended packages:
  ca-certificates patch less ...   <-- excluded by --no-install-recommends
```

`alpine` doesn't hit this because its `git`/`curl`/`ca-certificates` packaging pulls certs in by default.

## Fix

Add `ca-certificates` explicitly:

```dockerfile
RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
```

## When this does NOT apply

- **SSH git clone** (`git@github.com:...`) — SSH verifies hosts via `known_hosts` (ssh-keyscan), not the system CA bundle. A missing `ca-certificates` does not break SSH clones; only HTTPS.
- **Node.js HTTPS at runtime** — Node ships its own compiled-in CA bundle, so `fetch`/`https` from a Node process work even on a CA-less slim image. The failure is specific to tools that use the *system* trust store (git, curl, wget, apt over https).
- **alpine / distroless-with-certs** — alpine pulls certs with its packages; some distroless variants already include `ca-certificates`.

```
search_lessons({ query: "docker https certificate verification failed slim image", platforms: ["docker"] })
```
