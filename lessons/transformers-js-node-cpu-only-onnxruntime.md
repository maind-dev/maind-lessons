---
id: lsn_transformers_js_node_cpu_only_onnxruntime
title: "Diagnose 'Unsupported device: wasm' in @huggingface/transformers (Node) — only onnxruntime-node (device cpu)"
type: debugging_lesson
tier: community
lesson_class: general
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [node]
  tags: [transformers-js, onnxruntime, embeddings, docker, pnpm]
summary: "@huggingface/transformers selects its Node build (onnxruntime-node, device 'cpu') via package exports; passing device 'wasm' throws 'Unsupported device: wasm. Should be one of: cpu'. The web/WASM build does not initialize an ONNX session under plain Node. Plan for glibc (debian-slim, not alpine) plus an allowlisted native-binary install."
last_validated_at: "2026-06-01"
---

## Symptom

You add in-process embeddings with `@huggingface/transformers` (v3) in a Node service and try to force the WASM backend for portability:

```js
const { pipeline } = await import("@huggingface/transformers");
await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", { device: "wasm" });
// Error: Unsupported device: "wasm". Should be one of: cpu.
```

Or you ship to an `alpine` image and the model load fails because the `onnxruntime-node` native binding is missing / not loadable on musl.

## Why

`@huggingface/transformers` ships two builds and selects via `package.json` `exports` conditions:

- `node` condition → `dist/transformers.node.mjs` — backed **only** by `onnxruntime-node` (native addon). The only valid `device` is `cpu`.
- `default` → `dist/transformers.web.js` — the WASM/`onnxruntime-web` build, intended for the browser.

In Node you always get the node build, so `device: 'wasm'` is rejected before any model loads. Force-importing the web build by absolute path does not help: under plain Node it fails to initialize an inference session (`InferenceSession` is undefined — the web backend expects a browser-style ONNX runtime). So **`device: 'cpu'` / onnxruntime-node is the only supported path in Node.**

## Fix / recipe

1. Use `device: 'cpu'` (or omit `device` — the node build defaults to it).
2. **Base image must be glibc, not musl.** `onnxruntime-node` publishes prebuilt binaries for linux-x64 and linux-arm64 **glibc only** — there is no alpine/musl build. Use `node:20-slim` (debian), not `node:20-alpine`.
3. **Let the native binary install.** `onnxruntime-node` fetches its binary in a postinstall (`prebuild-install`). Modern pnpm (v9/v10) blocks dependency scripts by default, so allowlist it:

   ```yaml
   # pnpm-workspace.yaml
   onlyBuiltDependencies:
     - onnxruntime-node
   ```

   In a slimmed production install that uses `--ignore-scripts` (e.g. to skip workspace `prepare` hooks), the postinstall is skipped anyway — fetch the binary explicitly afterwards:

   ```dockerfile
   RUN pnpm install --prod --ignore-scripts
   RUN pnpm rebuild onnxruntime-node
   ```

4. Budget RAM: a small quantized encoder (e.g. bge-small q8) plus onnxruntime needs noticeably more than a keyword-only service — bump the container memory.

## Gotchas

- The `device: 'wasm'` error message looks like a typo/config issue but is actually telling you the WASM backend is unavailable in this build.
- A passing local install on macOS (darwin-arm64 prebuild) hides the alpine problem — it only surfaces when you build the linux image.
- Pre-cache the model into a fixed dir (`env.cacheDir` / `TRANSFORMERS_CACHE`) at build time so runtime needs no Hugging Face Hub fetch.

## When this does NOT apply

- **Browser / edge-WASM runtimes** (Cloudflare Workers, Deno Deploy, the actual browser) resolve the `default`/web build, where `device: 'wasm'` (and `webgpu`) are the right choice — there is no onnxruntime-node there.
- **You genuinely need musl/alpine and cannot switch base image:** then don't use onnxruntime-node — run embeddings out-of-process behind an OpenAI-compatible endpoint (e.g. a TEI/Ollama sidecar) and call `/embeddings` over HTTP instead of loading the model in-process.
- Pure browser-bundled apps already get WASM by default and never hit this.

## Related

```
search_lessons({ query: "transformers.js wasm unsupported device node onnxruntime", platforms: ["node"] })
```
