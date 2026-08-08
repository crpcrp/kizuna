# Runtime Binaries

Kizuna stages immutable Windows x64 and Linux x64 builds of mpv,
FFmpeg/ffprobe, and MeCab. These files are kept out of Git and staged under
`resources/` using one logical component layout per platform.

## Setup

Install Git LFS, then run:

```powershell
npm run resources
```

The command selects the current host platform, reads
[`resources.lock.json`](../resources.lock.json), fetches the pinned files from
the public [`crpcrp/kizuna-vendor`](https://github.com/crpcrp/kizuna-vendor)
mirror, and verifies every file by SHA-256. No credentials are required.

For a CI cross-check or a foreign-platform staging run, pass an explicit lock
key:

```powershell
npm run resources -- --platform linux-x64
npm run resources -- --platform win32-x64
```

The platform override changes only the selected payload; it does not make
Windows execute Linux binaries. The staging validation removes files managed by
the other platform and fails closed if optional yt-dlp has the wrong platform
suffix. First-party resource files are left alone.

To use an existing mirror checkout:

```powershell
npm run resources -- --vendor-dir C:\path\to\kizuna-vendor
```

The `KIZUNA_VENDOR_DIR` environment variable provides the same override.

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
| Linux x64 | MeCab | `resources/mecab/mecab` | Japanese tokenization via the relative-loader wrapper |

MeCab includes a UTF-8 IPADIC dictionary under `resources/mecab/ipadic/`.
An optional UniDic dictionary can be placed under
`resources/mecab/unidic/`.

The FFmpeg build must provide `libmp3lame` for mined sentence audio. If it does
not, card creation continues without that audio clip.

## Optional yt-dlp

Place `yt-dlp.exe` under `resources/yt-dlp/` on Windows or `yt-dlp` under that
directory on Linux to support extractor-backed URLs such as YouTube. It is not
installed by `npm run resources`, pinned in `resources.lock.json`, or updated
by Kizuna. Unpackaged Linux development checks `/usr/bin/yt-dlp` instead.

Without yt-dlp, local playback and direct media URLs still work. A packaged
installer includes yt-dlp only when it was present during packaging.

## Updating a pinned binary

1. Add the reviewed build, license texts, source reference, and build recipe to
   the vendor mirror.
2. Update the mirror commit and affected hashes in `resources.lock.json`.
3. Update the matching metadata in [`third-party.json`](../third-party.json).
4. Run:

   ```powershell
   npm run resources
   npm run notices
   npm test
   ```

The resource and notice checks reject mismatched pins, missing files, and
uncovered packaged components. See [Licensing and notices](licensing.md).

## Verification

```powershell
resources/mpv/mpv.exe --version
resources/ffmpeg/ffmpeg.exe -version
resources/ffmpeg/ffprobe.exe -version
resources/mecab/mecab.exe -v
```

On Ubuntu 24.04 x64, the pinned Linux payload targets glibc 2.39 and keeps
mpv/FFmpeg's exact Ubuntu package dependencies documented in the vendor
mirror. Verify the Linux files and modes on Linux:

```bash
resources/mpv/mpv --version
resources/ffmpeg/ffmpeg -version
resources/ffmpeg/ffprobe -version
resources/mecab/mecab -v
test -x resources/mecab/mecab.bin
```

CI uses the same resource command on the host platform. Tests use fakes and
fixtures instead of invoking these binaries or live services.
