#!/usr/bin/env node
// Validator for lesson Markdown files. Standalone (no app deps) so it can
// also run in the future maind-lessons{,-curated} repo's GH Action without
// pulling in the whole monorepo.
//
// Usage:
//   node scripts/validate-lessons.mjs                       # multi-dir mode (ADR-036)
//   node scripts/validate-lessons.mjs <dir>                 # single-dir mode (legacy)
//   node scripts/validate-lessons.mjs --dir <path>:<tier>   # explicit, repeatable
//
// In multi-dir mode the script scans both ./data/lessons-community (expected
// tier=community) and ./data/lessons-curated (expected tier=curated).
// Path-Heuristik (ADR-036): the directory bucket determines the expected tier;
// the lesson is rejected if frontmatter declares a different tier.
//
// Always also runs an injection-pattern scan (ADR-036/STRATEGY.md §7) on the
// body of every lesson and rejects matches.
//
// Exits non-zero on first invalid lesson or first injection match.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { argv, exit } from "node:process";

const ALLOWED_TYPES = new Set([
  "debugging_lesson",
  "workflow_best_practice",
  "recipe",
  "template",
]);
const ALLOWED_TIERS = new Set(["community", "curated"]);
const ID_RE_LESSON = /^lsn_\d{4}_[a-z0-9_]+$/;
const ID_RE_TEMPLATE = /^tmpl_\d{4}_[a-z0-9_]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SKIP_FILES = new Set(["readme.md"]);

// ── Injection-Pattern-Scan (STRATEGY.md §7 Risiko 1+2) ─────────────────
// Heuristic: catches the most common prompt-injection and remote-code patterns
// in lesson bodies. False-positive rate is non-zero — escape valid uses with
// `<noinject>…</noinject>` markers (stripped before scanning).
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

function scanInjection(file, body) {
  const cleaned = body.replace(/<noinject>[\s\S]*?<\/noinject>/g, "");
  const hits = [];
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(cleaned)) hits.push(p);
  }
  if (hits.length > 0) {
    for (const h of hits) {
      console.error(`✗ ${file}: injection-scan flagged '${h.id}': ${h.msg}`);
    }
    return false;
  }
  return true;
}

function fail(file, msg) {
  console.error(`✗ ${file}: ${msg}`);
  return false;
}

// Tiny YAML frontmatter parser — handles only what lessons actually use:
// scalars, quoted strings, arrays of strings (inline + block), nested objects,
// pipe-folded multiline strings (`field: |`). Rejects unsupported syntax loudly
// so we never silently let through a malformed lesson.
function parseFrontmatter(raw, file) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) {
    fail(file, "missing or malformed frontmatter (expected --- ... --- block)");
    return null;
  }
  const [, fmText, body] = m;
  const result = {};
  const lines = fmText.split(/\r?\n/);

  let i = 0;
  // Stack of {indent, container} — root is { -1, result }.
  const stack = [{ indent: -1, container: result, key: null }];

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.match(/^( *)/)[1].length;
    const trimmed = line.slice(indent);

    // Pop stack to current indent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const top = stack[stack.length - 1];

    // List item under current top.key
    if (trimmed.startsWith("- ")) {
      if (!top.key) {
        fail(file, `unexpected list item at line ${i + 1}`);
        return null;
      }
      const arr = top.container[top.key];
      if (!Array.isArray(arr)) {
        fail(file, `list item under non-array key '${top.key}' at line ${i + 1}`);
        return null;
      }
      arr.push(stripQuotes(trimmed.slice(2).trim()));
      i++;
      continue;
    }

    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      fail(file, `expected 'key: value' at line ${i + 1}: ${trimmed}`);
      return null;
    }
    const key = trimmed.slice(0, colon).trim();
    const rest = trimmed.slice(colon + 1).trim();

    if (rest === "") {
      // Either object or list follows on next indented lines
      // Peek the next non-blank line to decide.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      const next = lines[j] ?? "";
      const nextIndent = next.match(/^( *)/)[1].length;
      const isList = next.slice(nextIndent).startsWith("- ");
      const child = isList ? [] : {};
      top.container[key] = child;
      stack.push({ indent, container: child, key: null });
      // For lists, the parent acts as the container *of* the array; we mark
      // the key on the parent so list items push into top.container[top.key].
      if (isList) {
        // Re-push with parent semantics
        stack.pop();
        stack.push({ indent, container: top.container, key });
      }
      i++;
      continue;
    }

    if (rest === "|" || rest === ">") {
      // Block scalar: collect lines indented deeper than `indent`.
      const collected = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === "") {
          collected.push("");
          j++;
          continue;
        }
        const lIndent = l.match(/^( *)/)[1].length;
        if (lIndent <= indent) break;
        collected.push(l.slice(indent + 2));
        j++;
      }
      top.container[key] =
        rest === "|" ? collected.join("\n") : collected.join(" ").trim();
      i = j;
      continue;
    }

    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      top.container[key] = inner === ""
        ? []
        : inner.split(",").map((s) => stripQuotes(s.trim()));
      i++;
      continue;
    }

    top.container[key] = coerceScalar(rest);
    i++;
  }

  return { fm: result, body };
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function coerceScalar(s) {
  const stripped = stripQuotes(s);
  if (/^-?\d+$/.test(stripped)) return Number(stripped);
  if (stripped === "true") return true;
  if (stripped === "false") return false;
  return stripped;
}

function validate(file, fm, body, expectedTier) {
  let ok = true;
  function need(cond, msg) {
    if (!cond) ok = fail(file, msg);
  }

  // ID-Regex je nach type (ADR-038): templates → tmpl_NNNN_*, sonst lsn_NNNN_*
  const idRe = fm.type === "template" ? ID_RE_TEMPLATE : ID_RE_LESSON;
  need(typeof fm.id === "string" && idRe.test(fm.id),
    `id must match ${idRe} (got: ${JSON.stringify(fm.id)})`);
  need(typeof fm.title === "string" && fm.title.length > 0 && fm.title.length <= 200,
    "title required (1-200 chars)");
  need(ALLOWED_TYPES.has(fm.type),
    `type must be one of: ${[...ALLOWED_TYPES].join(", ")} (got: ${fm.type})`);
  need(ALLOWED_TIERS.has(fm.tier),
    `tier must be one of: ${[...ALLOWED_TIERS].join(", ")} (got: ${fm.tier})`);

  // ADR-036 Path-Heuristik: directory dictates tier
  if (expectedTier && fm.tier !== expectedTier) {
    need(false,
      `tier mismatch: file lives in ${expectedTier} bucket but frontmatter says '${fm.tier}'`);
  }

  need(fm.context && typeof fm.context === "object", "context block required");
  if (fm.context && typeof fm.context === "object") {
    for (const k of ["tools", "languages", "platforms", "tags"]) {
      if (fm.context[k] !== undefined) {
        need(Array.isArray(fm.context[k]) && fm.context[k].every((v) => typeof v === "string"),
          `context.${k} must be an array of strings`);
      }
    }
  }

  need(typeof fm.summary === "string" && fm.summary.length > 0 && fm.summary.length <= 500,
    "summary required (1-500 chars)");

  if (fm.gotchas !== undefined) {
    need(Array.isArray(fm.gotchas) && fm.gotchas.every((g) => typeof g === "string"),
      "gotchas must be an array of strings");
  }
  if (fm.last_validated_at !== undefined) {
    need(typeof fm.last_validated_at === "string" && ISO_DATE_RE.test(fm.last_validated_at),
      `last_validated_at must be ISO date YYYY-MM-DD (got: ${fm.last_validated_at})`);
  }
  if (fm.upvotes !== undefined) {
    need(Number.isInteger(fm.upvotes) && fm.upvotes >= 0,
      "upvotes must be a non-negative integer");
  }

  // Template-specific (ADR-038): type=template requires template_body + target_file
  if (fm.type === "template") {
    need(typeof fm.template_body === "string" && fm.template_body.trim().length > 0,
      "type=template requires non-empty 'template_body' frontmatter field");
    need(typeof fm.target_file === "string" && fm.target_file.trim().length > 0,
      "type=template requires 'target_file' (e.g. CLAUDE.md, AGENTS.md, .cursorrules)");
  }

  need(typeof body === "string" && body.trim().length > 0,
    "body (text after frontmatter) must not be empty");

  return ok && scanInjection(file, body);
}

function parseArgs(args) {
  // Returns array of {dir, tier|null}.
  // Modes:
  //   no args                  → multi-dir defaults (lessons-community + lessons-curated + templates)
  //   single positional        → legacy single-dir, tier from frontmatter
  //   --dir path:tier (repeat) → explicit list
  const explicit = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) {
      const [path, tier] = args[i + 1].split(":");
      if (tier && !ALLOWED_TIERS.has(tier)) {
        console.error(`Bad --dir tier '${tier}'; expected community|curated`);
        exit(2);
      }
      explicit.push({ dir: path, tier: tier ?? null });
      i++;
    } else if (!args[i].startsWith("--")) {
      explicit.push({ dir: args[i], tier: null });
    }
  }
  if (explicit.length > 0) return explicit;
  return [
    { dir: "./data/lessons-community", tier: "community" },
    { dir: "./data/lessons-curated", tier: "curated" },
    { dir: "./data/templates", tier: "curated" }, // ADR-038: templates always curated
  ];
}

async function listMd(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const out = [];
  for (const f of entries) {
    if (!f.endsWith(".md")) continue;
    if (SKIP_FILES.has(f.toLowerCase())) continue;
    const path = join(dir, f);
    const s = await stat(path);
    if (s.isFile()) out.push(f);
  }
  return { ok: true, files: out.sort() };
}

async function main() {
  const buckets = parseArgs(argv.slice(2)).map((b) => ({
    ...b,
    dir: resolve(b.dir),
  }));

  let allOk = true;
  let total = 0;
  const seenIds = new Set();

  for (const bucket of buckets) {
    const list = await listMd(bucket.dir);
    if (!list.ok) {
      // Empty/missing dir is OK in multi-dir mode — community may not yet have lessons.
      if (buckets.length > 1) {
        console.error(`(skip) ${bucket.dir}: ${list.error}`);
        continue;
      }
      console.error(`Cannot read ${bucket.dir}: ${list.error}`);
      exit(2);
    }
    if (list.files.length === 0) {
      console.error(`(empty) ${bucket.dir}`);
      continue;
    }

    for (const file of list.files) {
      const path = join(bucket.dir, file);
      const raw = await readFile(path, "utf-8");
      const parsed = parseFrontmatter(raw, file);
      if (!parsed) {
        allOk = false;
        continue;
      }
      if (!validate(file, parsed.fm, parsed.body, bucket.tier)) {
        allOk = false;
        continue;
      }
      if (seenIds.has(parsed.fm.id)) {
        fail(file, `duplicate id: ${parsed.fm.id}`);
        allOk = false;
        continue;
      }
      seenIds.add(parsed.fm.id);
      total++;
      console.log(`✓ ${bucket.tier ?? "?"}/${file}`);
    }
  }

  if (!allOk) {
    console.error(`\nValidation failed.`);
    exit(1);
  }
  if (total === 0) {
    console.error(`No lessons found in any bucket.`);
    exit(2);
  }
  console.log(`\nAll ${total} lessons valid.`);
}

main().catch((err) => {
  console.error(err);
  exit(2);
});
