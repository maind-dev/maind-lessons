---
id: lsn_macos_ditto_zip_entry_overflow
title: macOS Error 640 expanding an .app zip — ditto AppleDouble twins overflow the 16-bit ZIP entry counter
type: debugging_lesson
tier: community
summary: A zip of a macOS .app built with `ditto -c -k --sequesterRsrc` can exceed the ZIP format's 16-bit entry counter, because macOS stamps `com.apple.provenance` on every file and ditto then writes an AppleDouble twin per file. ditto writes no ZIP64 record, so the counter wraps and Archive Utility aborts with "Error 640" — while `unzip -t` reports no errors, because Info-ZIP never reads that counter. Fix is `--norsrc --noextattr`; dropping `--sequesterRsrc` alone is not enough.
last_validated_at: "2026-08-17"
context:
  tools: []
  languages:
    - bash
    - python
  platforms:
    - macos
  tags:
    - macos
    - ditto
    - zip
    - packaging
    - electron
    - code-signing
    - silent-failure
---

## Symptom — a contradiction, not a corruption

A user double-clicks the `.zip` of your macOS app and Finder refuses it:

```
Unable to expand "MyApp-1.0.0-darwin-arm64.zip" into "Downloads". (Error 640)
```

A partial `MyApp.app` is left behind. Meanwhile the obvious sanity check on your
machine says the archive is fine:

```
$ unzip -t MyApp-1.0.0-darwin-arm64.zip
No errors detected in compressed data of MyApp-1.0.0-darwin-arm64.zip.
```

That contradiction is the fingerprint. The archive is not corrupt — it is
**formally invalid in a field one reader trusts and the other ignores**. Web
searches for "Error 640" return "damaged or incomplete download", which is
wrong here and sends you to re-download a file that will fail again.

## The measurement that finds it

`zipinfo -h` prints the entry count *as declared in the End-of-Central-Directory*.
Count the entries yourself and compare:

```bash
Z=MyApp-1.0.0-darwin-arm64.zip
echo "reported: $(zipinfo -h "$Z" | grep -o 'entries: [0-9]*')"
echo "actual:   $(unzip -Z -1 "$Z" | wc -l)"
```

Measured on a real 1.9 GB Electron bundle: **reported 5,760 — actual 71,296**.
And `71,296 − 65,536 = 5,760`: the counter wrapped exactly once.

`unzip -t` cannot see this. Info-ZIP walks the central directory by its declared
**byte size** and never reads the entry counter, so it validates every entry and
reports success for an archive no end user can open. `zipinfo` without `-h` has
the same blind spot — it lists all entries, which is exactly what hides the
discrepancy. If your release check is `unzip -t`, it will certify this defect as
healthy.

## Root cause — three facts that only bite together

1. **macOS stamps `com.apple.provenance` on essentially every file.** In the
   measured bundle: 33,269 of 33,269 files carried exactly this one xattr.
2. **`ditto` writes an AppleDouble twin (`._name`) for every file carrying
   xattrs.** `--sequesterRsrc` decides only *where* the twins go (`__MACOSX/`
   versus beside the original) — never *whether* they exist. 33,269 files
   therefore became 71,296 entries.
3. **The EOCD "total number of entries" field is 16 bit** — maximum 65,535.
   ZIP64 exists for exactly this case, but `ditto` does not write the ZIP64
   record. The value wraps instead.

Archive Utility trusts the counter: it extracts 5,760 entries, then meets data
the header says cannot exist, and aborts. Squirrel.Mac and any other
count-trusting consumer behave the same way.

## Fix — plus two dead ends that look like fixes

```bash
ditto -c -k --norsrc --noextattr --keepParent MyApp.app MyApp.zip
```

On the same bundle: **33,269 reported, 33,269 actual**, 19 symlinks preserved,
signature intact. The signature survives because it lives in
`Contents/_CodeSignature/CodeResources` and embedded in the Mach-O binaries, not
in extended attributes — Apple's own notarization docs use
`ditto -c -k --keepParent` without `--sequesterRsrc` for the same reason.

The two dead ends, both of which cost time:

- **`xattr -cr MyApp.app` before packing.** `com.apple.provenance` is
  system-protected: the command exits 0 and changes nothing (measured: 8 xattrs
  before, 8 after). There is no error to notice.
- **Dropping `--sequesterRsrc` alone.** The twins merely move out of `__MACOSX/`
  to sit beside their originals. Measured: 66,537 entries — still over. This one
  is seductive because the `__MACOSX/` folder visibly disappears.

Verify the round trip, and mind the pipe: in a pipeline `$?` belongs to the
**last** command, so `codesign … | head -5; echo $?` reports `head`'s exit code
and always looks like a pass.

```bash
ditto -x -k MyApp.zip /tmp/rt
codesign --verify --deep --strict /tmp/rt/MyApp.app   # no pipe, or read ${PIPESTATUS[0]}
echo "codesign exit: $?"
```

The limit is a cliff, not a slope — a bundle at 60,000 entries is fine until
someone adds a dependency. Put the check in the release script instead of your
memory:

```python
import zipfile
with zipfile.ZipFile(asset) as z:
    actual = len(z.infolist())   # walks the central directory; ignores the counter
if actual > 65535:
    raise SystemExit(
        f"{asset.name} has {actual} entries (> 65,535). The EOCD counter wraps; "
        f"macOS will report 'Error 640' when a user expands it."
    )
```

## Auditing an asset you already published

Read only the tail and the central directory over HTTP range requests — a few
megabytes instead of several hundred. One gotcha: GitHub redirects to a storage
host that rejects *suffix* ranges (`bytes=-65536`) with **HTTP 501**, so resolve
the final URL first, then ask for explicit byte ranges.

```python
import subprocess, struct
url = "https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>.zip"
final = subprocess.run(["curl","-sL","-o","/dev/null","-w","%{url_effective}",url],
                       capture_output=True, text=True).stdout
head = subprocess.run(["curl","-sI",final], capture_output=True, text=True).stdout
n = int([l.split(":")[1].strip() for l in head.splitlines()
         if l.lower().startswith("content-length:")][0])
rng = lambda a, b: subprocess.run(["curl","-sL","-r",f"{a}-{b}",final],
                                  capture_output=True).stdout
tail = rng(max(0, n - 65536), n - 1)
e = tail[tail.rfind(b"PK\x05\x06"):][:22]
reported = struct.unpack("<H", e[10:12])[0]
cd_off, cd_size = struct.unpack("<I", e[16:20])[0], struct.unpack("<I", e[12:16])[0]
actual = rng(cd_off, cd_off + cd_size - 1).count(b"PK\x01\x02")
print("reported", reported, "| actual", actual)
```

## When this does NOT apply

- **Bundles that stay under 65,535 entries once the twins are counted.**
  Most non-Electron apps never come close.
- **Archives built with Info-ZIP `zip`.** It writes a ZIP64 record when needed,
  so the counter cannot wrap — but `zip` needs `-y` to preserve the symlinks an
  `.app` contains.
- **Non-macOS packaging.** The trigger is the AppleDouble twin, which only
  `ditto` on macOS produces.
- **Consumers that scan the central directory** (Info-ZIP `unzip`, Python
  `zipfile`, most CI tooling) open the archive without complaint. That asymmetry
  is the whole problem: invisible to your pipeline, fatal to your users.

Retrieve with `search_lessons({ query: "macos error 640 unable to expand zip app bundle", platforms: ["macos"] })`.
Sibling trap in the same build-and-verify loop:
[[lsn_macos_open_foregrounds_existing_instance]] — `open` foregrounds an
already-running copy instead of the build you just made.
