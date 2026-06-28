---
id: lsn_agent_navigation_validate_llm_route
tier: community
title: "Validate LLM-generated navigation routes server-side and act on the tool-result, not the raw tool-call"
type: workflow_best_practice
summary: "When an LLM agent navigates a UI through a tool (navigate(route)), it invents plausible-but-wrong targets — especially deep-link slugs guessed from a visible title, which 404. Validate the route in the tool's execute against an allowlist AND verify deep-link existence (e.g. the wiki slug actually exists); then have the client act on the validated tool-RESULT, not the raw tool-call input. Keep a client-side allowlist re-check as defense-in-depth."
context:
  tools: []
  languages: ["typescript", "javascript"]
  platforms: []
  tags: ["agents", "tool-calling", "navigation", "llm", "defense-in-depth"]
---

## The pattern

Give an agent a `navigate(route)` tool and it will, sooner or later, navigate to
a route that does not exist. The classic case: it reads an article titled
"Getting started in five minutes" and navigates to `/wiki/getting-started-in-
five-minutes` — but the real slug is `/wiki/getting-started`. The model
constructed the slug from the title instead of using the exact slug a prior
search tool returned. Result: a 404.

## Validate in the tool's execute — including deep-link existence

A static allowlist catches unknown top-level routes, but dynamic deep-links
(`/wiki/<slug>`, `/users/<id>`) pass a shape check yet can still 404. Verify the
target actually exists:

```ts
execute: async ({ route }) => {
  const r = normalizeRoute(route);
  if (!isAllowedRoute(r, role)) return { ok: false, error: "not allowed" };
  const m = /^\/wiki\/([a-z0-9-]+)$/.exec(r);
  if (m && !(await wikiSlugExists(m[1]))) {
    return { ok: false, error: `No article "${m[1]}". Use the EXACT slug from search.` };
  }
  return { ok: true, route: r };
}
```

A `{ ok: false, error }` result lets the model self-correct on the next step.

## Act on the tool-RESULT, not the raw tool-call

If your server streams the tool-CALL input to the client to trigger navigation,
you forward the model's unvalidated route. Forward the **tool-result** instead —
only after `execute` validated it:

```ts
// stream handler
if (part.type === "tool-result" && part.toolName === "navigate") {
  const out = part.output as { ok?: boolean; route?: string };
  if (out?.ok && out.route) clientNavigate(out.route);
}
```

## Defense-in-depth

The client should STILL re-validate the route against the allowlist before
`router.push` — never `push` a raw LLM string (open-redirect / unexpected-nav
guard). Server-validate, then client-revalidate.

## When NOT to apply

- Read-only "suggest a link" answers where the agent only mentions a route in
  text and the user clicks — the browser 404s harmlessly, no auto-nav to guard.
- Fully enumerable, static route sets with no dynamic deep-links: the allowlist
  alone suffices; the existence-check adds nothing.
