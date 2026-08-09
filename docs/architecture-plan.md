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
subtitles live only in the overlay. The renderer measures every DOM surface
which actually paints (chrome, sidebars, subtitles, menus, popups and modals),
and main applies those rectangles with `BrowserWindow.setShape`. The resulting
native holes expose mpv instead of asking the Linux compositor to alpha-blend
two top-level video surfaces, which produced black or flickering windows.
Electron's parent/child relationship keeps the shaped overlay above the host
without making Kizuna globally always-on-top.

Subtitle tracks are extracted and rendered separately in the DOM so their text
can be selected, tokenized, looked up, and styled by knowledge level.

`src/main/windowPair.ts` owns the platform-specific window lifecycle. On
Linux, `uiOverlay` owns normal user-driven position and size because its DOM
contains the native title-bar drag region and interactive resize border;
`videoHost` owns native fullscreen and taskbar surfaces. Move/resize events are
coalesced and synchronized from whichever side actually changed, while
programmatic writes are guarded so mirroring does not recurse. Fullscreen is
initiated only on the host, restored from one saved pre-fullscreen rectangle
after the native leave event, and reported to the renderer once per logical
transition. Mini-player bounds and requested always-on-top state are applied to
both sides as one operation. The parent relationship remains the normal
stacking mechanism; always-on-top is not used for ordinary Linux playback.

Windows continues to use the same coordinator interface backed by its one
transparent BrowserWindow, so window-control IPC does not duplicate platform
branches or change the existing single-window composition.

Runtime executables resolve from the host distribution during unpackaged Linux
development, from `resources/` during unpackaged Windows development, and from
Electron's resource directory in packaged Windows or Linux builds. The selected
platform's staged payload is validated before packaging. Subprocess output is
bounded and long-running operations use timeouts or cancellation where
appropriate.

## Local data

Kizuna stores dictionaries and vocabulary knowledge in separate SQLite
databases. Settings and media history are also local. WaniKani tokens use
Electron safe storage when available; the UI warns when the operating system
cannot provide encrypted storage.

Network access is limited to user-initiated features such as remote media,
online subtitles, subtitle translation, WaniKani sync, and AnkiConnect.
Translation uses Google's unofficial endpoint and is explicitly opt-in.

## Packaging

Windows x64 and NSIS are the published release targets. Windows x64 and Linux
x64 have immutable runtime payloads in the vendor lock map; the common
electron-builder resource layout works for either packaged target. The
installer includes the selected runtime binaries and generated third-party
notices.
`better-sqlite3` is rebuilt for Electron's ABI.

GitHub Actions runs independent, equally required Windows x64 and Linux x64
jobs that stage each host's runtime payload and run every quality check plus a
production build. The release
workflow still builds unsigned Windows x64 NSIS installers and verifies the
package, generates checksums, notices, and provenance, and prepares a draft
pre-release. Code signing is planned after the project is accepted by an
open-source signing service; see [Releasing](releasing.md) for the authoritative
release procedure.

Runtime binaries and their licensing metadata are pinned separately; see
[Runtime binaries](binaries.md) and
[Licensing and third-party notices](licensing.md).

## Testing

External processes, network services, and databases are exercised through
injected adapters, fakes, temporary databases, and committed fixtures.
Automated tests must not require live accounts, network access, or packaged
runtime binaries.
