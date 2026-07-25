---
id: lsn_macos_dir_size_cross_volume_double_count
title: "Fix recursive directory sizing that double-counts mounted volumes on macOS — skip cross-volume descendants"
type: debugging_lesson
tier: community
summary: "du and FileManager.enumerator on macOS descend across mount boundaries, so a mounted volume that appears as a subdirectory is double-counted — e.g. /Library/Developer/CoreSimulator/Volumes/<runtime> is the mounted view of a compressed Cryptex image, counted on top of the image itself. Fix: capture the scan root's volumeIdentifier and skip descendants whose volumeIdentifier differs (skipDescendants), or use du -x to stay on one filesystem."
context:
  tools: []
  languages: ["swift"]
  platforms: ["macos"]
  tags: ["macos", "apfs", "filesystem", "disk-usage", "filemanager", "mount-point"]
---

## Symptom

A disk-analysis tool reports a directory as much larger than it really is.
Concrete case: `/Library/Developer` shows ~28 GB, but the real allocated size is
~10 GB. The ~18 GB phantom comes entirely from
`/Library/Developer/CoreSimulator/Volumes/<runtime>` — the **mounted** view of an
iOS simulator runtime, which is the same bytes as the compressed
`CoreSimulator/Cryptex` image one level up. Both get summed, so the runtime is
counted twice.

The same class of over-report happens for any mounted DMG, disk image, APFS
firmlink into another volume, or network mount that sits under the path you are
sizing.

Retrieve this vetted convention when the symptom appears:

```
search_lessons({ query: "macos du directory size double counts mounted volume",
                 platforms: ["macos"], tags: ["disk-usage", "mount-point"] })
```

## Root cause

`du` (without `-x`) and `FileManager.enumerator` both descend across mount
boundaries by default. On modern macOS the OS mounts things *inside* otherwise
normal directories:

- Simulator runtimes are compressed **Cryptex** images that macOS mounts read-only
  under `CoreSimulator/Volumes/`.
- The signed system volume is firmlinked into `/`.
- Any user-mounted `.dmg` lands under `/Volumes` (or wherever it is attached).

A recursive size walk that follows those descendants adds the mounted bytes on
top of the backing image (or on top of a different volume's own accounting),
producing a total that can exceed the real disk usage.

## Fix — compare volumeIdentifier and skip cross-volume descendants

Capture the scan root's `volumeIdentifier` once, then drop any descendant whose
`volumeIdentifier` differs. In Swift with `FileManager.enumerator`:

```swift
let url = URL(fileURLWithPath: path)
let rootVolumeID = (try? url.resourceValues(
    forKeys: [.volumeIdentifierKey]))?.volumeIdentifier

let keys: Set<URLResourceKey> = [
    .totalFileAllocatedSizeKey, .isRegularFileKey,
    .isSymbolicLinkKey, .isDirectoryKey, .volumeIdentifierKey,
]
guard let e = FileManager.default.enumerator(
    at: url, includingPropertiesForKeys: Array(keys)) else { return 0 }

var total: Int64 = 0
for case let fileURL as URL in e {
    guard let v = try? fileURL.resourceValues(forKeys: keys) else { continue }
    // Skip anything on a different volume — mounted images, DMGs, net mounts.
    if let root = rootVolumeID, let vid = v.volumeIdentifier,
       !vid.isEqual(root) {
        if v.isDirectory == true { e.skipDescendants() }
        continue
    }
    if v.isSymbolicLink == true { continue }
    if v.isRegularFile == true {
        total += Int64(v.totalFileAllocatedSize ?? 0)
    }
}
```

`skipDescendants()` on the directory node is what prevents the walk from ever
entering the foreign volume, so it costs nothing.

The shell equivalent is `du -x` (stay on one filesystem):

```bash
du -x -sk /Library/Developer   # -x = do not cross mount points
```

Use `.totalFileAllocatedSize` (allocated blocks), not `.fileSize` (logical size),
so the total matches what the volume actually spends — this also handles APFS
sparse files and clones sanely.

## Bonus gotcha: purgeable space on recent macOS

If you also report APFS purgeable space (Time Machine local snapshots live here),
note that `diskutil apfs list` no longer prints a `Capacity Purgeable:` line on
recent macOS, so a parser of that output silently returns nil. Derive it natively
from the volume-capacity delta instead:

```swift
let v = try URL(fileURLWithPath: "/").resourceValues(forKeys: [
    .volumeAvailableCapacityForImportantUsageKey,  // includes purgeable
    .volumeAvailableCapacityKey,                    // excludes purgeable
])
let purgeableBytes =
    Double(v.volumeAvailableCapacityForImportantUsage ?? 0) -
    Double(v.volumeAvailableCapacity ?? 0)
```

`importantUsage` counts purgeable space as available; plain `available` does not,
so the difference is the purgeable reserve. Keep the `diskutil` parse only as a
fallback.

## When this does NOT apply

- **Single-volume trees.** If nothing is mounted under the path (a plain
  `~/Documents` subtree), there is no boundary to cross and the plain walk is
  correct. The fix is a no-op there, so it is safe to always apply.
- **You WANT the mounted content.** If your goal is "how much would the user see
  in Finder including mounted images", cross-volume counting is intentional — but
  then never compare that number against `df`/volume-capacity, which counts per
  volume.
- **Non-macOS.** Linux/Windows mount semantics differ; `du -x` still helps on
  Linux, but the Cryptex/firmlink specifics are macOS-only.

## Verification

Compare the fixed per-directory number against the volume's own accounting and
against `du -x`:

```bash
du -sk  /Library/Developer     # crosses mounts — inflated
du -x -sk /Library/Developer   # stays on volume — matches the fixed walk
```

If your in-app total now agrees with `du -x` (and the sum of top-level categories
no longer exceeds `df` used-space), the double-count is gone.
