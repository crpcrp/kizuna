# Runtime Binaries

Kizuna stages immutable Windows x64 and Linux x64 builds of mpv,
FFmpeg/ffprobe, and MeCab. These files are kept out of Git and staged under
`resources/` using one logical component layout per platform.

## Setup

```powershell
npm run resources
```

The command selects the host's lock in [`resources.lock.json`](../resources.lock.json),
downloads its payload from the public [vendor mirror](https://github.com/crpcrp/kizuna-vendor),
and verifies SHA-256. No credentials, git, or Git LFS client are required. Archives
cache in `.vendor-cache/` by hash; every run re-verifies files against the lock.
Each lock owns required paths, executable modes, and file hashes. Both platforms
pin one immutable mirror commit, release, manifest, and checksum file. Archive name,
SHA-256, and byte length are checked before unpacking. Windows source paths start
at archive root; Linux paths start under `linux-x64/`; both stage into `resources/`.

For a CI cross-check or a foreign-platform staging run, pass an explicit lock
key:

```powershell
npm run resources -- --platform linux-x64
npm run resources -- --platform win32-x64
```

Overrides stage a payload, not foreign-platform execution. Staging removes files
managed by the other platform and preserves first-party resources.
To use an unpublished local mirror clone:

```powershell
npm run resources -- --vendor-dir C:\path\to\kizuna-vendor
```

`KIZUNA_VENDOR_DIR` is equivalent. Local clones are used unchanged: no downloads
or deletions, but hashes must match. Run `git lfs pull` in that clone first.

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

Staging restores locked executable modes; packaging rejects missing execute bits.
Linux MeCab preserves `bin/`, `lib/`, and `etc/`: its wrapper resolves `../lib`
and `../etc/mecabrc`, which resolves `$(rcpath)/../ipadic`. Do not flatten it.
UTF-8 IPADIC ships in `resources/mecab/ipadic/`. Optional
[UniDic](../README.md#mecab-unidic) uses persistent user data; unpackaged Linux
uses system dictionaries.

The FFmpeg build must provide `libmp3lame` for mined sentence audio. If it does
not, card creation continues without that audio clip.

### Game OCR (Windows only)

Game OCR spawns a PP-OCR sidecar backed by CPU-only ONNX Runtime, so its payload is staged under
`resources/ppocr/` and bundled from `win.extraResources` alone. Linux
artifacts never carry it, `resolveGameOcrPaths` refuses to produce a Linux
path, and `resources.lock.json` may only stage `ppocr/` under `win32-x64`.

| Installed path | Purpose |
|---|---|
| `resources/ppocr/ppocr.exe` | Protocol-v1 PP-OCR sidecar built from patched RapidOcrOnnx |
| `resources/ppocr/onnxruntime.dll` | CPU-only ONNX Runtime 1.24.4 |
| `resources/ppocr/models/det.onnx` | PP-OCRv5 text-detection model |
| `resources/ppocr/models/rec.onnx` | PP-OCRv5 text-recognition model |
| `resources/ppocr/models/keys.txt` | Recognition dictionary extracted from model metadata |

The worker, runtime DLLs, models, and dictionary are checked before every Game
OCR arm attempt. A missing or wrong-kind entry is reported in Options > Game
OCR and clears on retry once the files are restored, so no capture is attempted
against an incomplete runtime.
The same paths are in `requiredPackagedResources`, so an installer built
without the worker or a model file fails the packaged smoke check rather than
the first capture.

The ~40.5 MB payload has a flat runtime root so the worker finds ONNX Runtime
and four VC runtime DLLs beside it. OpenCV, Clipper, zlib, and libpng link
statically; DirectML and the former inference runtime do not ship.

Foreground-window selection uses the MIT npm dependency Koffi, outside the vendor
lock. Its prebuilt Node-API binary needs no Electron rebuild; `asarUnpack` keeps
it loadable and npm notices cover its licence. See the
[native boundary](architecture.md#the-one-in-process-native-boundary).

`ppocr.exe` is GPL-3.0-or-later: its worker entrypoint adapts the first-party GPL
worker, so the whole executable is conveyed under GPLv3 even though its engine
and statically linked libraries use compatible permissive terms. The corresponding source and the script
that builds it live in the vendor mirror and are linked from the generated
`CORRESPONDING_SOURCE.md`.

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
