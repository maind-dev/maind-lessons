---
id: lsn_supabase_isolated_worktree_verification_target
title: Isolate Supabase local verification from sibling stacks and stale CLI state
type: debugging_lesson
tier: community
context:
  tools:
    - supabase-cli
    - psql
    - docker
  languages:
    - sql
    - bash
  platforms:
    - supabase
    - postgres
    - git
  tags:
    - supabase
    - worktree
    - local-development
    - parallel-sessions
    - migration-verification
summary: A safe isolated Supabase verification stack prevents a missing gitignored config, stale CLI state, or unrelated service healthcheck from mutating or obscuring a sibling session's database.
---

## Problem

In a git worktree, a gitignored supabase/config.toml may be absent, causing the CLI to target default ports or a different local project. A failed start can also leave stale project state, so later status output says a project is running while Docker has no matching containers. A naive repair, reset, or global stop can affect another session's database.

## Reusable pattern

1. Verify the worktree-local target configuration and project identity before any stateful Supabase command.
2. Use a unique project id and non-default port block for an isolated verification stack.
3. Start only the services required for the check; migration/RPC verification needs PostgreSQL, not every Supabase service.
4. If the CLI and Docker disagree, inspect the exact project id, stop only that project, and restart cleanly.
5. Verify the migration ledger, function definition, grants, and authenticated tenant behavior in a temporary transaction that always rolls back.
6. Remove only the exact temporary containers, volume, config copy, and fixture. Never use global stop, reset, or repair commands for a sibling project.

## Verification

Use a dedicated project id and port block, then verify identity before any write:

    supabase start --exclude edge-runtime,gotrue,imgproxy,kong,logflare,mailpit,postgres-meta,postgrest,realtime,storage-api,studio,supavisor,vector
    psql 'postgresql://postgres@127.0.0.1:<isolated-db-port>/postgres' -c 'select version from supabase_migrations.schema_migrations order by version'

Run tenant assertions inside BEGIN/ROLLBACK and confirm both the ledger and function ACL. If the CLI claims the project is running but the exact Docker container is absent, use supabase stop --project-id <isolated-project-id>, then restart only that project.

## Evidence

A fresh isolated MAIND replay applied migration 20261103200001 successfully. The RPC ACL was authenticated-only. A rolled-back two-organization test proved member-local rows, exact PR-head matching, and zero rows for an outsider and an unauthenticated context. The isolated stack and data volume were removed afterward.

## Scope and safety

This applies to provider-neutral Supabase/PostgreSQL worktree and local-stack verification. It does not establish cloud deployment; linked database push remains an explicit user action. Treat CLI output and repair suggestions as advisory, and confirm target identity mechanically before any state-changing command.

## When this does not apply

A single checkout with a known, unique local stack and no sibling sessions does not need a separate isolated project. Cloud database operations require their own explicit target and approval checks.