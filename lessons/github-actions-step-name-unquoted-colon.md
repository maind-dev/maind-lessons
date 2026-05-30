---
id: lsn_github_actions_step_name_unquoted_colon
title: "Diagnose GitHub Actions 0-job parse failures via the run.name=file-path probe"
type: debugging_lesson
tier: community
summary: |
  A GitHub Actions run with conclusion failure, empty jobs array, 0-second elapsed, and 404 on logs/annotations indicates a YAML parse fail before any runner was allocated. Fastest diagnostic: gh api run.name returns the literal .github/workflows/<file>.yml path instead of the declared workflow name, proving the parser bailed before reading the name: header. Most common cause: an unquoted value with colon-space inside a step or job name, which YAML 1.2 treats as a nested compact mapping.
context:
  platforms: ["github"]
  tools: []
  languages: []
  tags: ["github-actions", "yaml", "ci", "workflow-file-issue", "debugging", "diagnostic-signals"]
last_validated_at: "2026-05-29"
---

## Diagnostic signal

When a GitHub Actions run shows conclusion "failure" but the jobs array is empty and the run elapsed in 0 seconds, the workflow file was rejected at intake before any runner was scheduled. The WebUI displays the opaque message "This run likely failed because of a workflow file issue". The logs and annotations endpoints both return HTTP 404, so there is no surfaced error to grep.

The lever that bypasses this opacity is the .name field on the run object. GitHub falls back to the workflow file path when YAML parsing failed before reaching the top-level name: header.

```bash
gh api repos/<owner>/<repo>/actions/runs/<run_id> --jq '.name'
```

When the workflow parsed successfully, this returns the declared workflow name as written in the file's top-level name: header. When the parser bailed at intake, the same query returns the literal file path instead:

```json
".github/workflows/<file>.yml"
```

A .name response equal to the workflow file path is conclusive evidence that the parse failure is structural and very early — before the name: header was consumed. No amount of inspecting runner config, checkout actions, or matrix entries will surface the cause, because none of those were ever evaluated.

## Root cause

The verified mechanical fact is that GitHub's intake parser rejected the file and the eemeli/yaml npm parser categorised the same construct as "Nested mappings are not allowed in compact mappings". The deeper YAML 1.2 grammar rationale below is the author's reading of the spec, useful as orientation but not part of the original-incident observation.

YAML 1.2 compact-mapping syntax permits flow mappings as values of block-style keys. When a scalar value contains an unquoted colon followed by a space, the parser is forced to decide whether the value is a plain scalar or the start of a nested mapping. Inside a compact mapping that already lives inside another compact mapping (a step entry inside a steps list), the grammar disallows nesting another mapping at the same level.

The offending line in the originating workflow was:

```yaml
    - name: Pre-checkout (Windows: relax NTFS path validation)
      if: runner.os == 'Windows'
      shell: bash
```

The substring `Windows: relax NTFS path validation` contains the colon-space sequence inside the value of name:. YAML 1.2 treats `Windows` as a candidate key for a nested mapping, with `relax NTFS path validation` as its value. Because the enclosing step entry is itself a compact mapping (the `- name: …` form), the grammar rejects the nested mapping at the workflow-document level. GitHub Actions' YAML parser surfaces this as the generic "workflow file issue" without line context.

## Fix

The single-character fix is the leading quote on the step name string. Wrapping the scalar in double quotes turns it into a quoted scalar, which suppresses the colon-space tokenisation:

```diff
-    - name: Pre-checkout (Windows: relax NTFS path validation)
+    - name: "Pre-checkout (Windows: relax NTFS path validation)"
       if: runner.os == 'Windows'
       shell: bash
```

After the quote was added, the same workflow file ran the full matrix (ubuntu-latest, macos-latest, windows-latest) to green on the next push. Run elapsed time went from 0 seconds (parse fail) to multi-minute job execution. No other line in the workflow changed.

## Why three iterations missed it

The failure surface is structurally seductive toward incorrect hypotheses:

- The annotations endpoint returns HTTP 404, so there is no line/column hint.
- The logs endpoint returns HTTP 404, so there is nothing to grep.
- The check-runs endpoint shows no check-run registered for the head SHA.
- The jobs array is empty, so per-job inspection yields no output.
- The WebUI message "workflow file issue" carries no actionable information.
- The offending step has `if: runner.os == 'Windows'`, biasing diagnosis toward Windows-specific runner configuration.
- A permissive local YAML parser used incidentally during diagnosis accepted the file partially, giving false confidence that the YAML was structurally clean.

Three consecutive iterations on the originating incident changed surrounding scaffolding without touching the offending line:

- Iteration 1 adjusted the actions/checkout@v4 sparse-checkout cone-mode config.
- Iteration 2 added a pre-checkout step setting git config core.protectNTFS=false and core.longpaths=true.
- Iteration 3 added a step-level working-directory override using ${{ github.workspace }}.

Each change shipped, the workflow failed identically, and the next hypothesis targeted the next plausible Windows-runner surface. The fourth session found the fix by querying the .name field on the failing run and observing it returned the workflow file path.

The procedural takeaway: when a workflow run produces the 0-jobs / 0-seconds signature, the .name probe should precede any hypothesis about runner config. A .name response equal to the file path narrows the search to YAML structural ambiguity in the first declarations of the file, which short-circuits the runner-config iteration loop entirely.

## Generalisation

The same colon-space ambiguity applies to any YAML scalar field whose value is left unquoted. In GitHub Actions workflows the verified at-risk fields are step names, job names, env values, input strings, and output expressions. Other fields with unquoted scalar values are plausible candidates by the same grammar but were not enumerated in the originating incident's empirical scope.

Natural-language step names like `Setup (Linux: install deps)`, `Build (Windows: enable longpaths)`, or `Deploy (staging: skip on PR)` are particularly exposed because the parenthetical clarification idiom places a colon-space mid-string.

Known limits / non-claims:

- This vetted convention is verified only against the public GitHub.com YAML intake parser. Behaviour across GitHub Enterprise Server versions was not tested in the originating incident.
- Whether `yamllint -d strict` or `actionlint` would have flagged the construct pre-push is plausible but was not tested in the originating session.
- Equivalent behaviour in GitLab CI, CircleCI, or other YAML-driven CI systems was not verified.
- The .name-equals-file-path heuristic is verified on the public REST API and gh CLI; equivalent fallback semantics on enterprise deployments were not probed.

### When this diagnostic does not apply

The .name-equals-file-path probe is conclusive only when combined with the surrounding signature (conclusion=failure + jobs=[] + elapsed=0s + 404 on logs/annotations). Other failure modes have different signatures and require different diagnostics:

- **Permissions / token rejection**: jobs array is usually populated with a single set-up step that records the auth error; .name is the declared workflow name; logs endpoint returns content rather than 404.
- **Path filter rejection**: workflow simply does not trigger — no run is created at all. There is nothing to probe.
- **workflow_dispatch with invalid inputs**: run is created with conclusion failure but jobs array is non-empty (the first job records the input-validation error). .name shows the declared workflow name.
- **Concurrency-cancelled runs**: conclusion is "cancelled", not "failure"; elapsed is non-zero.
- **YAML files that are syntactically valid but reference invalid action versions**: jobs array is populated; per-job logs surface the action-resolution error.

When .name returns the file path, the search narrows to YAML structural ambiguity. When .name returns the declared workflow name, look elsewhere.

## Verification

GitHub's intake parser does not surface line/column context, so detection has to happen locally before push. The eemeli/yaml node snippet below is the empirically-confirmed detector — it produces the same structural-error category that GitHub silently rejected on. The yamllint recipe that follows is plausible coverage by the same rule class but was not empirically tested in the originating incident, and is offered as a suggestion rather than a verified detector.

Verified detector — direct parse via the eemeli/yaml npm package:

```bash
node -e "const fs=require('fs'); const YAML=require('yaml'); const doc=YAML.parseDocument(fs.readFileSync(process.argv[1],'utf8')); const errs=doc.errors; if(errs.length){console.error(errs.map(e=>e.message).join('\n')); process.exit(1);} else {console.log('ok');}" .github/workflows/<file>.yml
```

When the offending construct is present, the snippet emits a message of the form "Nested mappings are not allowed in compact mappings at line <N>, column <M>", which pinpoints the line GitHub's intake refused to surface.

Plausible-but-untested suggestion — yamllint in strict mode with quoted-strings enabled:

```bash
yamllint -d "{extends: default, rules: {truthy: enable, quoted-strings: {required: only-when-needed, extra-required: ['.*: .*']}}}" .github/workflows/
```

If this catches the construct in a given setup, treat it as a free additional layer; if it does not, fall back to the eemeli/yaml snippet which is the confirmed detector for this specific error category.

### Retrieving this convention from an agent

When an agent encounters the symptom signature, the search call to retrieve this convention is `search_lessons({ query: "github actions workflow file issue 0 jobs", platforms: ["github"], tags: ["yaml", "diagnostic-signals"] })`, or directly by id once the slug is known: `get_lesson({ id: "lsn_github_actions_step_name_unquoted_colon" })`.
