# Runtime Binaries

Kizuna stages immutable Windows x64 and Linux x64 builds of mpv,
FFmpeg/ffprobe, and MeCab. These files are kept out of Git and staged under
`resources/` using one logical component layout per platform.

## Setup

```powershell
npm run resources
```

The command selects the current host platform, reads
[`resources.lock.json`](../resources.lock.json), downloads that platform's
payload archive from the public
[`crpcrp/kizuna-vendor`](https://github.com/crpcrp/kizuna-vendor) mirror, and
verifies every file by SHA-256. No credentials, no git, and no Git LFS client
are required.

The archive is a release asset, not a clone. Cloning the mirror meant
`git lfs pull`, which downloads every LFS object at the commit — both
platforms' payloads, on every build that missed its cache — and Git LFS
bandwidth is a metered monthly quota that a few releases exhaust. The asset
carries one platform, compresses to roughly a third of the size, and is not
metered. It is unpacked into `.vendor-cache/`, stamped with the archive hash so
a second run skips the download, and re-verified from the lock every time
regardless.

Each platform lock owns its `requiredPaths`, `requiredExecutables`, and file
map. Both locks must name the same immutable mirror commit, release, manifest,
and checksum file; `source.archive` pins the asset by name, SHA-256, and byte
length, and the download is rejected before unpacking if either disagrees.
Windows sources live at the archive root; Linux sources live under
`linux-x64/`. Both are copied into the platform-neutral `resources/` layout
below, so runtime path selection does not leak vendor-mirror paths.

For a CI cross-check or a foreign-platform staging run, pass an explicit lock
key:

```powershell
npm run resources -- --platform linux-x64
npm run resources -- --platform win32-x64
```

The platform override changes only the selected payload; it does not make
Windows execute Linux binaries. The staging validation removes files managed by
the other platform. First-party resource files are left alone.

To stage from a local clone of the mirror instead of the release asset — the
usual loop when a payload is being changed and not yet published:

```powershell
npm run resources -- --vendor-dir C:\path\to\kizuna-vendor
```

The `KIZUNA_VENDOR_DIR` environment variable provides the same override. A
directory supplied this way is used exactly as it is: nothing is downloaded,
nothing is deleted, and the hashes still have to match. That clone is the one
place a `git lfs pull` is still needed.

## Required files

| Platform | Component | Installed path | Purpose |
|---|---|---|---|
| Windows x64 | mpv | `resources/mpv/mpv.exe` | Video playback |
| Windows x64 | FFmpeg | `resources/ffmpeg/ffmpeg.exe` | Subtitle extraction and sentence-audio clips |
| Windows x64 | ffprobe | `resources/ffmpeg/ffprobe.exe` | Media, track, and chapter inspection |
| Windows x64 | MeCab | `resources/mecab/mecab.exe` | Japanese tokenization |
| Linux x64 | mpv | `resources/mpv/mpv` | Video playback |
| Linux x64 | FFmpeg | `resources/ffmpeg/ffmpeg` | Subtitle extraction and sentence-audio clips |
| Linux x64 | ffprobe | `resources/ffmpeg/ffprobe` | Media, track, and chapter inspection |
| Linux x64 | MeCab | `resources/mecab/bin/mecab` | Japanese tokenization via the relative-loader wrapper |

Linux executable modes come from the lock and are restored during staging;
packaging fails if a required executable loses its execute bit. The Linux
MeCab payload keeps the mirror's own `bin/`, `lib/`, and `etc/`
layout rather than being flattened like the other components. Its wrapper
resolves `../lib` for `libmecab.so.2` and `../etc/mecabrc` for its
configuration, both relative to the wrapper's own directory, and `mecabrc`
in turn resolves `$(rcpath)/../ipadic`. Moving the wrapper next to those
directories instead of above them leaves every file present and executable
while `mecab.bin` fails to load its shared library at runtime.

MeCab includes a UTF-8 IPADIC dictionary under `resources/mecab/ipadic/`.
An optional UniDic dictionary belongs in Kizuna's persistent user-data folder,
not under the package-managed resources directory:

- Windows: `%APPDATA%\Kizuna\mecab\unidic`
- Linux: `~/.config/Kizuna/mecab/unidic`

Use Options > Parser & Dictionaries > Open UniDic folder to create and reveal
the exact folder. Existing Windows installations that used the old
`resources/mecab/unidic` location are preserved by the installer and migrated
on startup; packaged Linux runs migrate the same legacy path when it remains
available, while unpackaged Linux keeps using the system UniDic without copying
it. The persistent location survives package updates.

The FFmpeg build must provide `libmp3lame` for mined sentence audio. If it does
not, card creation continues without that audio clip.

### Game OCR (Windows only)

Game OCR spawns a PaddleOCR sidecar, so its payload is staged under
`resources/paddleocr/` and bundled from `win.extraResources` alone. Linux
artifacts never carry it, `resolveGameOcrPaths` refuses to produce a Linux
path, and `resources.lock.json` may only stage `paddleocr/` under `win32-x64`.

| Installed path | Purpose |
|---|---|
| `resources/paddleocr/paddleocr.exe` | PaddleOCR sidecar and its Paddle Inference runtime |
| `resources/paddleocr/models/det` | Japanese text-detection model |
| `resources/paddleocr/models/rec` | Japanese text-recognition model |

All three are checked before every Game OCR arm attempt. A missing or
wrong-kind entry is reported in Options > Game OCR and clears on retry once the
files are restored, so no capture is attempted against an incomplete runtime.
The payload is not pinned in `resources.lock.json` yet; until the vendor mirror
carries it, `npm run resources` stages nothing under `paddleocr/` and Game OCR
reports the missing worker.

## Updating a pinned binary

1. Add the reviewed build, license texts, source reference, build recipe, and
   updated `manifest.json`/`SHA256SUMS.txt` to the vendor mirror. Do not replace
   files at an existing pin.
2. Publish the payload archives for the new mirror commit by running
   `scripts/publish-payloads.sh` there. It prints the `source` block to paste
   here, including the archive hashes.
3. Pin the new full mirror commit and release in both platform locks, but change
   file maps and hashes only for the platform being updated. The lock validator
   requires both platforms to use one immutable vendor snapshot.
4. Update only the matching platform metadata in
   [`third-party.json`](../third-party.json).
5. Stage and verify the changed platform explicitly, then verify both lock
   selections and notices:

   ```bash
   npm run resources -- --platform win32-x64
   npm run notices
   npm run resources -- --platform linux-x64
   npm run notices
   npm test
   ```

6. Build and smoke-test the changed package on its native host. A platform
   override verifies schema, hashes, and copying but cannot execute a foreign
   payload or prove Linux file modes on Windows.

The resource and notice checks reject mismatched pins, missing files, and
uncovered packaged components. See [Licensing and notices](licensing.md).

## Verification

```powershell
resources/mpv/mpv.exe --version
resources/ffmpeg/ffmpeg.exe -version
resources/ffmpeg/ffprobe.exe -version
resources/mecab/mecab.exe -v
```

On Ubuntu 24.04 x64, the pinned Linux payload targets glibc 2.39. Its mpv,
FFmpeg, and ffprobe executables are unmodified distro binaries and deliberately
load non-baseline shared libraries from `mpv (= 0.37.0-1ubuntu4)` and
`ffmpeg (= 7:6.1.1-3ubuntu5)`; those libraries are not copied into Kizuna.
MeCab carries its own relative wrapper and `libmecab.so.2`. The exact loader
policy and package list live in the vendor mirror's
`LINUX_X64_DEPENDENCIES.md`. Verify the Linux files and modes on Linux:

```bash
resources/mpv/mpv --version
resources/ffmpeg/ffmpeg -version
resources/ffmpeg/ffprobe -version
resources/mecab/bin/mecab -v
test -x resources/mecab/bin/mecab.bin
echo 日本語 | resources/mecab/bin/mecab -d resources/mecab/ipadic
```

Run the MeCab commands rather than only checking the files exist: a wrapper
that cannot find its shared library is indistinguishable from a working one
until it is executed. `npm run smoke:linux` makes the same check against a
packaged artifact.

CI uses the same resource command on the host platform. Tests use fakes and
fixtures instead of invoking these binaries or live services.
