---
id: lsn_wa_sqlite_node_fts5_vfs
title: "Fix wa-sqlite under Node for FTS5 + real-file persistence — the fork, the wasmBinary, and a synchronous fs VFS"
type: debugging_lesson
tier: community
summary: "wa-sqlite (WASM SQLite) in Node without a native .node hits 4 walls: (1) upstream wa-sqlite@1.0.0 ships NO FTS5 — use the @journeyapps/wa-sqlite fork (MIT, FTS5 built in, same API); (2) its Emscripten ESM build fetch()es the .wasm, undici can't fetch file:// in Node — pass { wasmBinary }; (3) no Emscripten FS/disk VFS — write a sync FacadeVFS over fs.*Sync; (4) mxPathname (lowercase n) for long paths, bridge I/O via pData.subarray()."
context:
  languages:
    - typescript
    - javascript
  platforms:
    - node
    - wasm
  tools:
    - vscode
  tags:
    - wa-sqlite
    - sqlite
    - wasm
    - fts5
    - vscode-extension
    - vfs
last_validated_at: "2026-07-05"
---

## Context

You want SQLite in a Node host **without a native `.node` binary** — the canonical case is a VS Code extension packaged with `vsce package --no-dependencies` (only `dist/**` ships, no `node_modules`), where a native `better-sqlite3` would force a per-platform `.vsix` matrix. `wa-sqlite` (WASM SQLite) is the portable answer and also runs in VS Code Web. But four things bite in order:

## Wall 1 — upstream `wa-sqlite@1.0.0` ships no FTS5

`wa-sqlite@1.0.0` (the only published version) has **two** prebuilt builds — `dist/wa-sqlite.mjs` (sync) and `dist/wa-sqlite-async.mjs` (asyncify) — and **neither includes FTS5**:

```
SQLiteError: no such module: fts5
```

`strings wa-sqlite.wasm | grep -c fts5` → `0` for both. JSON1 is present, FTS5 is not. Getting FTS5 upstream means a custom emsdk build (`-DSQLITE_ENABLE_FTS5`) + a committed artifact.

**Fix:** use **`@journeyapps/wa-sqlite`** (the PowerSync fork, MIT — same `LICENSE`, Roy T. Hashimoto). Its builds compile FTS5 in (`strings … | grep -c fts5` → 38), and it exposes the **identical** `Factory()` / `FacadeVFS` API + the same OPFS/IDB example VFS classes, so it is a drop-in. Bonus: your on-disk schema (FTS5 vtable + `bm25()`) stays identical to a native better-sqlite3 store.

Note: the fork's `package.json` has no `license` field (the LICENSE file is MIT). A lockfile-based license gate will read it as `UNKNOWN` — add an explicit per-package override.

## Wall 2 — Emscripten ESM `fetch()`es the .wasm; undici can't do file://

The ESM factory locates its `.wasm` with `fetch(new URL('...wasm', import.meta.url))`. Under Node that throws:

```
TypeError: fetch failed … cause: Error: not implemented... yet... (undici schemeFetch for file://)
```

**Fix:** read the bytes yourself and hand them to the factory — this bypasses the fetch path entirely:

```ts
import SQLiteESMFactory from "@journeyapps/wa-sqlite/dist/wa-sqlite.mjs";
import { Factory } from "@journeyapps/wa-sqlite";
const wasmBinary = readFileSync(require.resolve("@journeyapps/wa-sqlite/dist/wa-sqlite.wasm"));
const module = await SQLiteESMFactory({ wasmBinary });
const sqlite3 = Factory(module);
```

In a **bundled** host (esbuild → `dist/extension.cjs`) `require.resolve`/`createRequire(import.meta.url)` do not work (no `node_modules`, and `import.meta.url` is empty in a cjs bundle → a top-level `createRequire(import.meta.url)` *throws at load*). Copy the `.wasm` into `dist/` at build time and read it from an injected asset dir; keep any `createRequire` lazy inside the non-bundled branch.

## Wall 3 — no Emscripten FS, no built-in disk VFS → write a synchronous fs VFS

wa-sqlite compiles **without** the Emscripten filesystem (`grep -c NODERAWFS wa-sqlite.mjs` → 0; there is no `Module.FS`). It persists **only** through its JS VFS layer, and the shipped example VFS classes target the browser (OPFS `AccessHandlePoolVFS`, IndexedDB `IDBBatchAtomicVFS`) — **none for Node**. So a "just serialize memory to a file" approach has no hook; the canonical path is a small **synchronous** `FacadeVFS` subclass over `fs.*Sync`, giving a real on-disk SQLite file:

```ts
import { FacadeVFS } from "@journeyapps/wa-sqlite/src/FacadeVFS.js";
import * as VFS from "@journeyapps/wa-sqlite/src/VFS.js";
class NodeFsVFS extends FacadeVFS {
  mxPathname = 1024;                       // see Wall 4
  static async create(name, m) { const v = new NodeFsVFS(name, m); await v.isReady(); return v; }
  jOpen(name, id, flags, pOut) { /* openSync(name, RDONLY | (RDWR|CREAT)) */ }
  jRead(id, pData, off)  { const d = pData.subarray(); const n = readSync(fd, d, 0, d.byteLength, off);
                           if (n < d.byteLength) { pData.fill(0, n); return VFS.SQLITE_IOERR_SHORT_READ } return VFS.SQLITE_OK }
  jWrite(id, pData, off) { const s = pData.subarray(); writeSync(fd, s, 0, s.byteLength, off); return VFS.SQLITE_OK }
  /* jTruncate=ftruncateSync, jSync=fsyncSync, jFileSize=fstatSync, jDelete=unlinkSync, jAccess=existsSync */
}
const vfs = await NodeFsVFS.create("nodefs", module);
sqlite3.vfs_register(vfs, true);
const db = await sqlite3.open_v2(dbPath, SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE, "nodefs");
await sqlite3.exec(db, "PRAGMA journal_mode=MEMORY;");   // WAL needs shared-memory VFS hooks you don't implement
```

A synchronous VFS works with the **sync** build (no asyncify overhead). Use `journal_mode=MEMORY` (or `DELETE`) — WAL requires the shared-memory (`xShm*`) hooks the base VFS doesn't provide; for a single-process host it's unnecessary anyway.

## Wall 4 — the two silent VFS bugs

- **`mxPathname` (lowercase `n`).** The base property is `mxPathname`, not `mxPathName`. Set it too low (default 64) and an absolute db path overflows the core `xFullPathname` buffer → `open_v2` fails with `SQLITE_IOERR` (code 10). Setting `mxPathName` (capital N) is a silent no-op.
- **`pData` is a heap proxy, not a real TypedArray.** `FacadeVFS` hands `jRead`/`jWrite` a `Uint8ArrayProxy` (a lazy view over the WASM heap). Passing it straight to `fs.readSync`/`writeSync` throws `ERR_INVALID_ARG_TYPE … Received an instance of Uint8ArrayProxy`. Call `pData.subarray()` — it returns a live `Uint8Array` view into the heap, so `readSync` fills WASM memory directly and `writeSync` reads it directly (zero copy). Use `pData.fill(0, n)` for the short-read tail.

## When this does NOT apply

- **Browser / VS Code Web host:** use the fork's own `AccessHandlePoolVFS` (OPFS) or `IDBBatchAtomicVFS` — Wall 3's Node-fs VFS is Node-only, and the browser factory resolves the `.wasm` via `fetch` normally (no `wasmBinary` needed).
- **You can ship a native binary:** `better-sqlite3` is simpler and faster on the desktop; the whole exercise is about avoiding `.node`.
- **You don't need FTS5:** upstream `wa-sqlite` is fine (JSON1 is present); the fork is only required for the full-text index.

```js
search_lessons({ query: "wa-sqlite node fts5 wasm sqlite vfs file persistence", platforms: ["node", "wasm"] })
```
