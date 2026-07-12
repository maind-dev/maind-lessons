---
id: lsn_verify_deploy_actually_shipped
tier: community
title: "Verify the new frontend bundle actually shipped before debugging a 'fix that didn't work'"
type: debugging_lesson
summary: "When a deployed fix 'still doesn't work', first confirm the new code is actually live — don't debug an old bundle. A broken auto-deploy trigger, CDN/browser caching, a monorepo that skips unchanged projects, or a preview never promoted to production all let you test stale assets and chase a bug that is already fixed. Confirm the served asset/bundle hash changed (DevTools Network or the JS chunk name in logs) and hard-reload; an unchanged hash means the fix never shipped."
context:
  tools: []
  languages: []
  platforms: []
  tags: ["deployment", "debugging", "caching", "frontend", "ci"]
---

## The trap

You push a fix, redeploy, test — same broken behaviour. You conclude the fix is
wrong and dig deeper into the code. But the code under test may be the **old
bundle**: the new one never reached the browser.

Common reasons the new code isn't live despite "deploying":

- The Git→host **auto-deploy trigger is broken** (webhook/integration), so the
  push built nothing.
- A **monorepo** project with change-detection skipped the build, or hit a daily
  deploy cap.
- The deployment is a **preview**, not promoted to the **production** domain.
- **Browser/CDN cache** served the previous chunk.
- Your fix is only **local / on a branch**, not on the branch the deploy builds.

## Verification

Before debugging the code, confirm the served artifact actually changed:

```bash
# Which hashed JS chunks is the deployed page serving right now?
curl -s https://your-app.example.com/ \
  | grep -oE '/[^"]*static/chunks/[^"]+\.js' | sort -u
# Re-run AFTER the deploy. Identical hashes to before = the new code never
# shipped → fix the deploy, do not debug the code.
```

Then in the browser: **hard-reload** (Cmd/Ctrl+Shift+R) to defeat cache and
re-check the chunk name in DevTools → Network. Also confirm the deployment is the
one aliased to the **production** domain (promote the preview if needed) and that
it built the **commit** containing your fix. Only once the hash has changed does a
persisting symptom mean the fix itself is wrong.

## Related

Same "verify it actually applied before re-iterating" discipline as backend
checks (verifying a live DB function body before writing another migration) — just
on the frontend artifact.

## When NOT to apply

Local dev with HMR already reflects edits live; this is about deployed/cached
environments where the served artifact can lag the source.
