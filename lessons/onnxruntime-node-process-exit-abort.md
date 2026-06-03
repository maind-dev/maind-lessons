---
id: lsn_onnxruntime_node_process_exit_abort
title: "onnxruntime-node exit 134 ('mutex lock failed') on Node teardown — isolate the model in a short-lived child"
type: debugging_lesson
tier: community
lesson_class: architecture
quality_tier: experimental
context:
  tools: []
  languages: [javascript, typescript]
  platforms: [macos, node]
  tags: [onnxruntime, transformers-js, embeddings, node, process-lifecycle, sigabrt]
summary: "A Node process that loads an onnxruntime-node model (e.g. Transformers.js feature-extraction) can abort on EXIT with 'libc++abi: mutex lock failed: Invalid argument' (exit 134 / SIGABRT) — AFTER all work finished and stdout flushed. The native threadpool teardown races on shutdown. Fix: isolate model loading in a short-lived child process and verify its output artifact, not its exit code."
problem: |
  A batch/CLI Node script embeds text with Transformers.js (`@huggingface/transformers`,
  `device: "cpu"` → onnxruntime-node) or calls onnxruntime-node directly. The work
  completes — results are printed, files written — and THEN, during process exit,
  the process aborts:

  ```
  libc++abi: terminating due to uncaught exception of type
  std::__1::system_error: mutex lock failed: Invalid argument
  ```

  Exit code is 134 (128 + SIGABRT). Observed on macOS (darwin-arm64), Node 20. It
  looks like a crash, but every side effect already happened — the abort is purely
  in native teardown of the ONNX runtime threadpool after JS has finished.
solution: |
  Isolate the model load into a dedicated, short-lived child process whose only job
  is: load model → do the inference → write the result to a file (or stdout) → exit.
  The orchestrator and any downstream consumers never `import`/initialize the model,
  so their exits stay clean. Crucially, the parent verifies the child's OUTPUT
  ARTIFACT, not its exit code — the child may still SIGABRT on teardown after the
  artifact is flushed.

  ```js
  // parent: spawn the embed-only child, then trust the artifact
  spawnSync(process.execPath, [scriptPath], {
    env: { ...process.env, MODE: "embed", OUT: outPath },
  });
  let vectors;
  try { vectors = JSON.parse(readFileSync(outPath, "utf-8")); }
  catch { throw new Error("embed child produced no valid artifact"); }
  if (vectors.length !== expected) throw new Error("short artifact");
  // child exit code intentionally NOT checked — teardown SIGABRT is benign here
  ```

  Long-lived servers don't see this: they keep the runtime warm and never exit
  (e.g. `min_machines_running=1`). The abort only bites short-lived processes that
  load the model and then terminate.
gotchas:
  - "The abort happens AFTER stdout is flushed, so all real output is already correct — don't chase a phantom logic bug. Check the exit signal: 134 / SIGABRT with valid output = teardown race, not a failure of the work."
  - "Importing the embedding package for pure helpers (cosineSimilarity, constants) does NOT trigger it — only the first actual model load (lazy pipeline init) starts the native threadpool. Keep score-only / math-only processes free of any embed call and they exit cleanly."
  - "Don't 'fix' it with process.exit(0) in the parent — that runs the same native teardown and can abort identically. The fix is isolation (the model lives in a process you can let die dirty), not a different exit call."
  - "In a multi-weight / multi-config sweep, embed ONCE in the isolated child and hand the vectors to the config processes — this both removes N model loads and confines the only abort-prone process to one short-lived run."
last_validated_at: "2026-06-02"
evidence: "Reproduced repeatedly on darwin-arm64 (Node 20, @huggingface/transformers feature-extraction, bge-small-en-v1.5 q8) in a batch embedding + eval-sweep harness; exit 134 fired only at teardown, after stdout flush and file writes completed."
upvotes: 0
---

## Symptom signature

```
<all expected output prints / files written>
libc++abi: terminating due to uncaught exception of type
  std::__1::system_error: mutex lock failed: Invalid argument
# process exits 134
```

If the *work* is correct and complete and the abort message mentions a `mutex` /
`system_error` during teardown, you are looking at native runtime shutdown, not
your code. The tell is timing: the abort is the **last** thing, after your final
`console.log` / `writeFile`. This is the inverse of [[lsn_surface_silent_errors_first]]:
there a real failure hides silently; here a loud abort is benign — both mislead if
you read the signal at face value.

Retrieve this convention when the symptom appears:

```
search_lessons({ query: "onnxruntime node exit 134 mutex lock failed teardown", tags: ["onnxruntime", "node"] })
```

## Why it happens

`device: "cpu"` is the only supported Transformers.js backend under plain Node
(the WASM/web build does not initialize an ONNX session there), and it runs on
`onnxruntime-node`. That native addon spins up a threadpool on first inference.
On process exit the JS side and the native destructor race; on some platforms
(seen on macOS/libc++) the threadpool's mutex is already gone when the destructor
runs, and the uncaught `system_error` aborts the process. There is no exposed
dispose() that reliably orders this teardown from JS.

## The fix: process isolation

Put the model where it is allowed to die dirty:

1. A dedicated child does model-load + inference + write-artifact + exit.
2. The orchestrator spawns it, then reads and validates the artifact — never the
   child exit code (it may be 134 even on success).
3. Every other process in the pipeline (orchestration, scoring, aggregation)
   avoids any model call, so they exit cleanly and their exit codes stay
   meaningful.

This also composes well with parameter sweeps: embed inputs once in the isolated
child, persist the vectors, and let each downstream config process consume them —
fewer model loads and a single abort-prone process.

## When this does NOT apply

- **Long-lived servers / workers.** They keep the runtime warm and never exit, so
  teardown never runs. Don't add child-process plumbing to a service for this.
- **Pure-helper imports.** Importing only `cosineSimilarity`/constants from an
  embedding wrapper doesn't load the native runtime; those processes exit fine.
- **Other OS/runtime combos.** Verified on macOS/libc++ + onnxruntime-node. If you
  don't see exit 134 with the mutex message, you have a different problem — don't
  pre-emptively add isolation.
- **A real error before teardown.** If output is missing/short OR the abort message
  is a different exception, treat it as a genuine failure, not this benign race.
