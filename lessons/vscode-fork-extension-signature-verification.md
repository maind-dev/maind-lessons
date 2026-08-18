---
id: lsn_vscode_fork_extension_signature_verification
title: Fix `Signature verification was not executed` in a VS Code OSS fork — patch the shared-process fallback
type: debugging_lesson
tier: community
summary: In a VS Code fork built from OSS sources, every gallery extension install fails with `Signature verification was not executed` — the check needs `@vscode/vsce-sign`, which only Microsoft's builds ship, and Open VSX signs its extensions so the path is always taken. The load-bearing detail is where to patch — the fallback in `extensionManagementService.ts`, not the workbench property default, because the install runs in the shared process, which reads only the user settings.json.
last_validated_at: "2026-08-17"
context:
  tools:
    - vscode
  languages:
    - typescript
  platforms: []
  tags:
    - vscode-fork
    - vscodium
    - open-vsx
    - extensions
    - code-signing
    - build-patches
---

## Symptom

In a fork built from `microsoft/vscode` (VSCodium-style recipe: clone a pinned
tag, apply patches, merge your own `product.json`), **no** extension installs
from the gallery — not one, not just signed ones:

```
$ code --install-extension anthropic.claude-code
Installing extension 'anthropic.claude-code'...
Error while installing extension anthropic.claude-code: Signature verification was not executed.
Failed Installing Extensions: anthropic.claude-code
```

Two things reliably send people down the wrong path. First, the message says
*"was not executed"*, not *"failed"* — which reads like a transient hiccup
rather than a structural gap. Second, on macOS an unsigned fork also triggers
Gatekeeper dialogs, so "trust the unsigned app" looks like the same problem
class. It is not: Gatekeeper decides whether the *app* runs; this decides
whether an *extension* is accepted.

## Root cause — a module the fork legally cannot ship

Verification runs through `@vscode/vsce-sign`, which is **proprietary and
present only in Microsoft's own builds**. In an OSS build it is absent, so
`ExtensionSignatureVerificationService` returns nothing, `verificationStatus`
stays `undefined`, and the gate in `extensionManagementService.ts` throws.

The reason it hits *everything* is the gallery side: Open VSX signs its
extensions, so `extension.isSigned` is true and the verification path is always
entered. There is no unsigned extension that slips past — the branch that would
allow one (`NotSigned` while the gallery does not require signatures) is never
reached.

A useful corollary for the "but it worked last month" case: a fork's behaviour
here can change with **no client change at all**, because `isSigned` is derived
from what the gallery advertises in its `extensionquery` response. When a
registry starts exposing the signature asset through that endpoint, every OSS
fork pointing at it stops installing extensions on the same day. (Observed: a
fork installed an extension from Open VSX in late July and refused the identical
extension in mid-August, with binaries that had not changed. The signature file
itself predated the successful install, which points at the endpoint rather than
the artifact — a plausible reading of the evidence, not a verified server-side
fact.)

## The load-bearing detail — where the fix must go

There are two plausible places to change the default, and only one of them
works:

| Candidate | What it is | Does it fix the install? |
|---|---|---|
| `extensions.contribution.ts` — the property registration (`default: true`) | what the Settings UI shows | **No** |
| `extensionManagementService.ts` — `verifySignature = isBoolean(value) ? value : true` | the value that actually decides | **Yes** |

The reason is process topology. The install runs in the **shared process** (and
in the CLI process for `--install-extension`), and that process builds its
configuration service over the user settings file alone:

```ts
// vs/code/electron-utility/sharedProcess/sharedProcessMain.ts
new ConfigurationService(userDataProfilesService.defaultProfile.settingsResource, …)
```

The workbench property registration does not exist there. `getValue` returns
`undefined`, `isBoolean(undefined)` is false, and the **fallback** decides.
Patch the registration only and you change the number the Settings UI displays
while the behaviour stays exactly as broken.

Two related dead ends worth knowing before you try them:

- **`configurationDefaults` in `product.json` is not a supported field.** It is
  not part of `IProductConfiguration` and no production code reads it; a distro
  ships defaults through a bundled extension's `contributes.configurationDefaults`.
- **That extension mechanism does not help here either** — extension-contributed
  defaults are registered in the workbench/extension host, which the shared
  process never consults.

## Fix

**Per machine, immediately** — this works because the shared process *does* read
the user settings file:

```jsonc
// ~/Library/Application Support/<AppName>/User/settings.json  (or platform equivalent)
{ "extensions.verifySignature": false }
```

**In the build, durably** — a two-line patch. Change the fallback so the default
is off, and pull the registered default along so the Settings UI stops claiming
a check that cannot happen:

```diff
--- a/src/vs/platform/extensionManagement/node/extensionManagementService.ts
+++ b/src/vs/platform/extensionManagement/node/extensionManagementService.ts
 		if (verifySignature) {
 			const value = this.configurationService.getValue(VerifyExtensionSignatureConfigKey);
-			verifySignature = isBoolean(value) ? value : true;
+			verifySignature = isBoolean(value) ? value : false;
 		}
--- a/src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts
+++ b/src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts
 			[VerifyExtensionSignatureConfigKey]: {
 				type: 'boolean',
-				default: true,
+				default: false,
```

This removes no protection that was ever in effect — the build cannot perform
the check. The switch survives: a user who sets `"extensions.verifySignature": true`
gets upstream behaviour back, including the same refusal.

Verify against an empty profile, so a leftover user setting cannot flatter the
result:

```bash
code --user-data-dir /tmp/probe --extensions-dir /tmp/probe-ext \
     --install-extension <publisher>.<name>
# expect: "was successfully installed"
```

On macOS, verify the rebuilt fork itself rather than whatever LaunchServices
decides to foreground — see [[lsn_macos_open_foregrounds_existing_instance]];
`open` will happily raise the previously installed copy with the same bundle id,
which makes a working patch look like a failed one.

## The build-recipe trap that arrives with your first patch

Fork recipes keep the upstream checkout between builds and apply patches
unconditionally:

```bash
for p in patches/*.patch; do
  git -C vscode apply --check "../$p"   # set -e turns this into an abort
  git -C vscode apply "../$p"
done
```

With an empty `patches/` this is harmless, so the defect ships unnoticed. With
your first real patch, **every second build fails** — and it fails with
`patch does not apply`, which reads like a rebase conflict against a new
upstream tag rather than "already applied". Make the step idempotent:

```bash
for p in patches/*.patch; do
  if git -C vscode apply -R --check "../$p" 2>/dev/null; then
    git -C vscode apply -R "../$p"      # already applied — take it back out first
  fi
  git -C vscode apply --check "../$p"
  git -C vscode apply "../$p"
done
```

## When this does NOT apply

- **Microsoft's official VS Code builds** ship the proprietary module;
  verification works and should stay on.
- **VSIX sideloads** (`--install-extension ./thing.vsix`) never go through the
  gallery signature path, so they install regardless — which is why a fork can
  look healthy right up to the first marketplace install.
- **Forks pointing at a gallery that advertises no signature assets** are
  unaffected until that registry changes — see the corollary above; treat this
  as a dormant issue rather than an absent one.
- **Anything Gatekeeper-related** (unsigned/unnotarized app, quarantine
  attribute) is a separate layer with separate fixes.

Retrieve with `search_lessons({ query: "vscode fork signature verification was not executed extension install", tools: ["vscode"] })`.
