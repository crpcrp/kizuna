# Runtime Binaries

Kizuna packages Windows x64 builds of mpv, FFmpeg/ffprobe, and MeCab. These files
are kept out of Git and staged under `resources/`.

## Setup

Install Git LFS, then run:

```powershell
npm run resources
```

The command reads [`resources.lock.json`](../resources.lock.json), fetches the
pinned files from the public
[`crpcrp/kizuna-vendor`](https://github.com/crpcrp/kizuna-vendor) mirror, and
verifies every file by SHA-256. No credentials are required.

To use an existing mirror checkout:

```powershell
npm run resources -- --vendor-dir C:\path\to\kizuna-vendor
```

The `KIZUNA_VENDOR_DIR` environment variable provides the same override.

## Required files

| Component | Installed path | Purpose |
|---|---|---|
| mpv | `resources/mpv/mpv.exe` | Video playback |
| FFmpeg | `resources/ffmpeg/ffmpeg.exe` | Subtitle extraction and sentence-audio clips |
| ffprobe | `resources/ffmpeg/ffprobe.exe` | Media, track, and chapter inspection |
| MeCab | `resources/mecab/` | Japanese tokenization |

MeCab includes a UTF-8 IPADIC dictionary under `resources/mecab/ipadic/`.
An optional UniDic dictionary can be placed under
`resources/mecab/unidic/`.

The FFmpeg build must provide `libmp3lame` for mined sentence audio. If it does
not, card creation continues without that audio clip.

## Optional yt-dlp

Place `yt-dlp.exe` under `resources/yt-dlp/` to support extractor-backed
URLs such as YouTube. It is not installed by `npm run resources`, pinned in
`resources.lock.json`, or updated by Kizuna.

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

CI uses the same resource command on Windows. Tests use fakes and fixtures
instead of invoking these binaries or live services.
