---
id: lsn_electron_run_as_node_bundled_cli
title: "Ship a Node CLI inside an Electron app without bundling Node — ELECTRON_RUN_AS_NODE"
type: workflow_best_practice
summary: >-
  An Electron application already contains a full Node runtime. Setting
  ELECTRON_RUN_AS_NODE=1 makes the app binary behave as a plain `node` interpreter, so a
  CLI bundled into the app bundle needs no separate Node binary — roughly 50 MB saved
  and one fewer moving part. The catch is native modules: prebuilt bindings are compiled
  against npm's Node ABI, not Electron's, so anything native must be loaded lazily and
  allowed to degrade.
tier: community
context:
  tools: []
  languages:
    - javascript
    - typescript
  platforms:
    - electron
    - node
  tags:
    - electron
    - packaging
    - node
    - native-modules
    - cli
---

## The problem this solves

You want a CLI (an MCP bridge, a language server, an indexer) to ship *with* a
desktop app rather than be installed separately, because separate installation is
where the failure lives: `npm i -g` installs per Node version, so a user who
switches Node silently keeps running an old copy. Putting the CLI inside the app
bundle and referencing it by absolute path removes PATH, npm and nvm from the
equation in one move.

The obvious objection is size: bundling a Node runtime alongside an Electron app
means shipping Node twice. You don't have to.

## The mechanism

Electron's main binary checks `ELECTRON_RUN_AS_NODE` at startup. When set, it skips
all Chromium/browser initialisation and behaves as a plain Node interpreter — same
argv handling, same module resolution, same `process.execPath` semantics.

```bash
# The app binary IS a node interpreter
ELECTRON_RUN_AS_NODE=1 "/Applications/YourApp.app/Contents/MacOS/YourApp" \
  -e "console.log(process.version)"
# → v24.18.0

# ...so it runs your bundled CLI directly
ELECTRON_RUN_AS_NODE=1 "/Applications/YourApp.app/Contents/MacOS/YourApp" \
  "/Applications/YourApp.app/Contents/Resources/app/your-cli/node_modules/your-cli/build/index.js" --version
```

Bundling is then an ordinary npm install into a directory inside the app:

```bash
npm install --prefix "$APP/Contents/Resources/app/your-cli" --omit=dev your-cli@1.2.3
```

## Writing the launch config

If your CLI writes its own launcher config (an MCP `mcpServers` entry, a systemd
unit, a hook command), have it derive the values from the running process rather
than hardcoding them. Inside the bundle, `process.execPath` is already the app
binary and `import.meta.url` is already the bundled entry — so the same code path
produces the correct config in both the standalone and the bundled case:

```js
const isElectron = process.versions.electron !== undefined;
const launch = {
  command: process.execPath,                      // app binary when bundled
  args: [fileURLToPath(import.meta.url)],         // bundled entry when bundled
  env: isElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
};
```

This only works if the published artifact is a real, runnable JS file — a package
whose entry still points at TypeScript source resolves fine for bundler consumers
and fails for exactly this pure-Node path (see
[[lsn_workspace_runtime_values_need_built_artifact]]).

Rendering the launch as a single shell string (for hook configs that accept one
command) means putting the env assignments first and quoting the paths — app bundles
live under paths with spaces:

```
ELECTRON_RUN_AS_NODE=1 '/Applications/Your App.app/Contents/MacOS/Your App' '/path/to/entry.js' subcommand
```

## The native-module catch

`npm install` builds or downloads prebuilt native bindings for the **Node ABI of the
npm that ran**, not for Electron's. Electron ships a different ABI
(`process.versions.modules` differs), so a bundled `better-sqlite3`, `sharp`, or
`node-pty` will refuse to load under `ELECTRON_RUN_AS_NODE`.

Three ways out, in order of preference:

1. **Make the native module optional and lazy.** If it powers one feature, `await
   import()` it at first use inside a `try`, and degrade that feature when it throws.
   The rest of the CLI keeps working. This is the cheapest correct answer and the one
   to design for before you bundle anything.
2. **Rebuild for Electron** with `@electron/rebuild` or `prebuild-install --runtime
   electron --target <electron-version>`. Correct, but pins your bundle to an Electron
   version and adds a build step that breaks on every upgrade.
3. **Replace it with a WASM equivalent** (`sql.js`/`wa-sqlite` for SQLite,
   `web-tree-sitter` for tree-sitter). ABI-free by construction.

The same prebuilt-binary-versus-runtime mismatch appears whenever a native addon
meets a runtime it wasn't built for — [[lsn_transformers_js_node_cpu_only_onnxruntime]]
is the glibc/musl variant of the identical trap.

Verify which situation you are in before shipping:

```bash
ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/YourApp" \
  -e "require('better-sqlite3'); console.log('native OK')"
# throws NODE_MODULE_VERSION mismatch → you are in the lazy-load-or-rebuild case
```

## When this does NOT apply

- **The CLI must run when the app is not installed.** A bundled CLI dies with the
  app; if users invoke it from CI or a bare terminal, publish it normally as well.
- **You need a specific Node version.** The bundled interpreter is whatever Node the
  app's Electron embeds; you inherit its upgrade cadence and cannot pin independently.
- **Heavy native dependencies that cannot degrade.** If the CLI *is* the native module
  (an image pipeline, a database engine), option 2 is mandatory and the bundling
  savings are eaten by the rebuild pipeline.
- **Cross-platform single artifact.** This only helps where the app is already
  platform-specific. If you ship one universal artifact, you have not saved a Node
  download — you have moved it.

## Verification

```bash
# 1. interpreter works
ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/App" -e "console.log(process.version)"
# 2. bundled CLI answers
ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/App" "$ENTRY" --version
# 3. macOS only: any change to an app bundle breaks its signature. Re-sign, or the
#    OS kills the app at launch on arm64 with no dialog and no crash report.
codesign --force --deep -s - "$APP" && codesign --verify --deep --strict "$APP"; echo "exit=$?"
```

Step 3 is not optional and not a footnote: make it part of the bundling script, not
an instruction printed after it. A step whose omission fails invisibly must not
depend on the caller remembering it. The same script must refuse to run while the
app is open — re-signing a running app can have macOS kill it silently.

Finding this again:

```
search_lessons({
  query: "bundle node CLI inside electron app without shipping node runtime",
  platforms: ["electron", "node"]
})
get_lesson({ id: "lsn_electron_run_as_node_bundled_cli" })
```
