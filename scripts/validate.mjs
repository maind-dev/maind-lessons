#!/usr/bin/env node
// Validates every lesson in this repository against the REAL Zod schema
// (@maind-dev/content-schemas) — the exact definition the maind MCP server
// loads lessons with — plus the injection-pattern scan (STRATEGY.md §7).
//
// This replaces the previous hand-built re-implementation of the lesson
// schema. That validator was deliberately dependency-free so this repo could
// build without the monorepo — reasonable at the time, but it meant the
// schema existed twice and the copies could drift silently. Since the schemas
// are published, this repo validates with the same source of truth.
//
// Why structural validity matters this much: a lesson that does not parse
// against the real schema does not crash the server. Its store catches the
// error, logs one stderr line, and loads the rest — the entry sits in this
// repo looking fine and silently reaches no user. This run makes that a red
// PR check instead.
//
// The authoritative, always-current gate still runs in the maind monorepo
// (content-bundle workflow + Docker deploy gate) against the monorepo's
// CURRENT schemas. This run is the fast local feedback at PR time; the pin in
// package.json says exactly which schema release it checks against.
//
// Usage:  node scripts/validate.mjs

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { LessonSchema } from "@maind-dev/content-schemas";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Bucket → schema, exactly as the server maps directories to content classes.
 * `expectedTier` keeps the ADR-036 path heuristic: a lesson living in this
 * repo IS curated; frontmatter claiming otherwise is a mistake the schema
 * alone cannot see (both tiers are valid lesson shapes).
 */
const BUCKETS = [
  { dir: "lessons", schema: LessonSchema, label: "lesson", expectedTier: "community" },
];

// ── Injection-Pattern-Scan (STRATEGY.md §7 Risiko 1+2) ─────────────────
// Carried over verbatim from the previous validator. The same five patterns
// live in the curated repo's validator — two deliberate copies, one per
// content repo, so each stays self-contained; if they ever need to change,
// centralising them in @maind-dev/content-schemas is the move. Escape valid
// uses with <noinject>…</noinject>.
const INJECTION_PATTERNS = [
  {
    id: "ignore-previous",
    re: /\bignore (all |any |the )?(previous|above|prior|earlier) (instructions|prompts|rules|messages)\b/i,
    msg: "prompt-injection phrase 'ignore previous instructions'",
  },
  {
    id: "system-prompt-override",
    re: /\b(you are now|forget you are|pretend you are|act as if|roleplay as) (a|an|the) /i,
    msg: "system-prompt override pattern",
  },
  {
    id: "rm-rf-root",
    re: /rm\s+-rf\s+(\/(?!\w)|~\s|\$HOME)/,
    msg: "destructive shell command (rm -rf / or $HOME)",
  },
  {
    id: "curl-pipe-shell",
    re: /(curl|wget)[^|`]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/,
    msg: "curl|sh remote-execution pattern",
  },
  {
    id: "base64-eval",
    re: /\b(eval|exec)\s*\(\s*(atob|Buffer\.from)\s*\(/,
    msg: "base64-decode-then-eval pattern",
  },
];

function scanInjection(body) {
  const cleaned = body.replace(/<noinject>[\s\S]*?<\/noinject>/g, "");
  return INJECTION_PATTERNS.filter((p) => p.re.test(cleaned));
}

let checked = 0;
const failures = [];

for (const { dir, schema, label, expectedTier } of BUCKETS) {
  let entries;
  try {
    entries = await readdir(join(ROOT, dir));
  } catch {
    console.log(`(no ${dir}/ directory — skipping)`);
    continue;
  }
  const files = entries
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .sort();

  let ok = 0;
  for (const file of files) {
    checked += 1;
    const raw = await readFile(join(ROOT, dir, file), "utf-8");
    const problems = [];

    let parsed;
    try {
      parsed = matter(raw);
    } catch (err) {
      problems.push(`frontmatter unreadable: ${err instanceof Error ? err.message : err}`);
    }

    if (parsed) {
      // The exact payload shape the server builds at load time.
      const result = schema.safeParse({ ...parsed.data, body: parsed.content.trim() });
      if (!result.success) {
        for (const i of result.error.issues) {
          problems.push(`${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
        }
      }
      if (expectedTier && parsed.data?.tier !== expectedTier) {
        problems.push(
          `tier mismatch: file lives in the ${expectedTier} bucket but frontmatter says '${parsed.data?.tier}'`,
        );
      }
      for (const hit of scanInjection(parsed.content)) {
        problems.push(`injection scan [${hit.id}]: ${hit.msg} — escape a legitimate use with <noinject>…</noinject>`);
      }
    }

    if (problems.length > 0) failures.push({ path: `${dir}/${file}`, problems });
    else ok += 1;
  }
  console.log(`${failures.some((f) => f.path.startsWith(dir + "/")) ? "✗" : "✓"} ${dir}: ${ok}/${files.length} valid as ${label}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${checked} file(s) failed:`);
  for (const { path, problems } of failures) {
    console.error(`  ${path}`);
    for (const p of problems) console.error(`    · ${p}`);
  }
  console.error(
    "\nA file that fails the schema does not error at runtime — the server skips it" +
      "\nsilently and it reaches no user. Fix before merging.",
  );
  process.exit(1);
}
console.log(`\nAll ${checked} files valid against @maind-dev/content-schemas.`);
