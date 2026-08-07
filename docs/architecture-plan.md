# Kizuna Architecture

Kizuna is a Windows-first Electron application. This document records the
stable boundaries contributors should preserve; feature-level file locations
are listed in [the codebase map](codebase-map.md).

## Processes

- The Electron renderer contains the React interface. It has no direct Node,
  filesystem, database, subprocess, or network access.
- A narrow typed preload API connects the renderer to validated handlers in the
  main process.
- The main process owns local storage, network requests, and child processes.
- mpv, FFmpeg/ffprobe, MeCab, and optional yt-dlp run as separate executables.

Electron runs with context isolation enabled and Node integration disabled.
IPC channels are declared centrally in `src/shared/ipcChannels.ts`, and the
renderer-facing contract is defined in `src/shared/preloadApi.ts`.

## Playback and subtitles

On Windows, mpv renders into Kizuna's single transparent frameless window and
is controlled through JSON IPC over a named pipe. On Linux, Electron uses X11
and owns an opaque `videoHost` plus a transparent child `uiOverlay`: mpv's
`--wid` targets only the host, while the renderer, preload, controls, and DOM
subtitles live only in the overlay. Electron's parent/child relationship keeps
the overlay above the host without making Kizuna globally always-on-top.

Subtitle tracks are extracted and rendered separately in the DOM so their text
can be selected, tokenized, looked up, and styled by knowledge level. Linux
window movement, resizing, fullscreen, and mini-player synchronization are
handled by the follow-up window-lifecycle slice; the initial pair is aligned
once before presentation.

Runtime executables resolve from `resources/` in development and Electron's
resource directory in packaged builds. Subprocess output is bounded and
long-running operations use timeouts or cancellation where appropriate.

## Local data

Kizuna stores dictionaries and vocabulary knowledge in separate SQLite
databases. Settings and media history are also local. WaniKani tokens use
Electron safe storage when available; the UI warns when the operating system
cannot provide encrypted storage.

Network access is limited to user-initiated features such as remote media,
online subtitles, subtitle translation, WaniKani sync, and AnkiConnect.
Translation uses Google's unofficial endpoint and is explicitly opt-in.

## Packaging

Windows x64 and NSIS are the supported release targets. The installer includes
the staged runtime binaries and generated third-party notices.
`better-sqlite3` is rebuilt for Electron's ABI.

GitHub Actions builds unsigned Windows x64 NSIS installers. The release
workflow verifies the package, generates checksums, notices, and provenance,
and prepares a draft pre-release. Code signing is planned after the project is
accepted by an open-source signing service; see [Releasing](releasing.md) for
the authoritative release procedure.

Runtime binaries and their licensing metadata are pinned separately; see
[Runtime binaries](binaries.md) and
[Licensing and third-party notices](licensing.md).

## Testing

External processes, network services, and databases are exercised through
injected adapters, fakes, temporary databases, and committed fixtures.
Automated tests must not require live accounts, network access, or packaged
runtime binaries.
