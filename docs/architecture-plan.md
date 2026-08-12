# Kizuna Architecture

Kizuna is a Windows and Linux Electron application. This document records the
stable boundaries contributors should preserve; feature-level file locations
are listed in [the codebase map](codebase-map.md).

## Processes

- The Electron renderer contains the React interface. It has no direct Node,
  filesystem, database, subprocess, or network access.
- A narrow typed preload API connects the renderer to validated handlers in the
  main process.
- The main process owns local storage, network requests, and child processes.
- mpv, FFmpeg/ffprobe, and MeCab run as separate executables.

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
Electron's parent/child relationship owns the pair, while presentation and
focus explicitly raise the host and place the shaped overlay immediately above
it. This prevents another application from appearing through the video-shaped
hole without making Kizuna globally always-on-top.

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
both sides as one operation. The parent relationship plus direct host/overlay
z-ordering remains the normal stacking mechanism; always-on-top is not used for
ordinary Linux playback.

Windows continues to use the same coordinator interface backed by its one
transparent BrowserWindow, so window-control IPC does not duplicate platform
branches or change the existing single-window composition.

Runtime executables resolve from the host distribution during unpackaged Linux
development, from `resources/` during unpackaged Windows development, and from
Electron's resource directory in packaged Windows or Linux builds. The selected
platform's staged payload is validated before packaging. Subprocess output is
bounded and long-running operations use timeouts or cancellation where
appropriate.

## Game OCR (Windows only, experimental)

Game OCR is a second, self-contained surface: a global shortcut freezes the
display under the mouse pointer, PP-OCR reads it locally through ONNX Runtime, and interactive
text boxes are drawn over the detected regions. It is Windows only. The capture
service, the frozen-frame window, and the preload's `supported` flag all refuse
any other platform, so no Linux or macOS behavior is implied or claimed.

Ownership follows the same process boundaries as the rest of the application.
Display capture, the global shortcut, the native window, the tray, and the
PP-OCR subprocess live in the main process behind injected interfaces;
PP-OCR itself is a spawned sidecar speaking a newline-delimited JSON
protocol over stdio, never a linked library. Only validated, serializable data
crosses the preload: a base64 screenshot with its media type, its dimensions,
and normalized OCR regions. Executable paths, native image handles, and raw
worker output stay in main. The screenshot is encoded once, as JPEG, and those
bytes serve both the frozen frame and the OCR worker: the encode sits directly
between the hotkey and the pixels the user sees, and a lossless full-display
encode costs more on every step that follows it than PP-OCR can resolve.

The frozen frame is its own renderer entry point (`src/renderer/gameOcr.html`),
loaded into a dedicated opaque, always-on-top, full-display BrowserWindow
placed at the captured display's logical bounds — including negative
coordinates on a secondary monitor. It is deliberately separate from the
player's window pair: it must cover the game rather than participate in
video-host/overlay stacking, and it must be closable without touching playback.
That window is sandboxed with context isolation like the main renderer, and it
reuses the existing tokenization, knowledge, dictionary, popup, and optional
translation surfaces through the same bridges.

One window serves every capture in an armed run. A frame ends by dropping its
screenshot and hiding; only stopping, a display change, or an unusable renderer
destroys the window, and the coordinator builds a replacement on the next
capture. Retaining it is what keeps a frame's latency to the capture itself
rather than a renderer boot, and it moves the retained window onto whichever
display the newest capture came from. The renderer therefore treats every
screenshot as a boundary: it re-reads the player's preferences and clears the
text selection, while keeping the lookup caches that make later frames faster.

One session ID orders everything. A capture invalidates the previous session,
hides the previous frozen frame, waits for confirmation that it is no longer
visible, allows one bounded compositor-settle step, and only then captures — so
a recapture can never read Kizuna's own screenshot. The settle step is skipped
when no frozen frame of Kizuna's own was visible when the session began, since
the compositor then has nothing of ours to repaint. Capture, OCR,
tokenization, lookup, and translation results are accepted only for the current
session; a failed recapture leaves the live game visible rather than restoring
a stale frame.

While Game OCR is armed the player window hides behind a tray icon, and
stopping or quitting releases the shortcut, the worker process, the frozen
window, the retained screenshot, and the tray together.

OCR runs locally and the models are bundled; the only network path is the
existing opt-in translator, and only for text the user explicitly selects. The
PP-OCR / ONNX Runtime payload ships in Windows artifacts alone. See
[Game OCR](game-ocr.md) for behavior and limitations, and
[Runtime binaries](binaries.md) for the payload layout.

## Local data

Kizuna stores dictionaries and vocabulary knowledge in separate SQLite
databases. Settings and media history are also local. WaniKani tokens use
Electron safe storage when available; the UI warns when the operating system
cannot provide encrypted storage.

Network access is limited to user-initiated features such as subtitle
translation, WaniKani sync, and AnkiConnect.
Translation uses Google's unofficial endpoint and is explicitly opt-in.

Application updates are also main-process-owned. One service uses the packaged
electron-builder GitHub configuration, keeps download and installation behind
separate user actions, and publishes only a serializable state snapshot through
the preload bridge. It checks automatically once at application startup and does
not schedule repeated checks; later checks require an explicit manual action. The
renderer never receives update URLs, credentials, cache paths, or installer paths.
Unpackaged and unknown package formats remain offline and report an unsupported
state.

## Packaging

Published targets are Windows x64 as an NSIS installer and Ubuntu 24.04 x64 as
an AppImage and Debian package. Windows x64 and Linux x64 have separate
immutable payloads in the vendor lock map, staged into the common
`resources/` layout before packaging. Each artifact includes only its selected
runtime executables and generated third-party notices. The Linux mpv and
FFmpeg executables intentionally use shared libraries from the pinned Ubuntu
packages; MeCab carries its relative loader, library, and dictionary layout.
Linux launchers select Electron's X11 backend automatically so the
same packages work from X11 desktops and from Wayland desktops through
XWayland without user-supplied command-line arguments.
`better-sqlite3` is rebuilt for each host's Electron ABI.

GitHub Actions runs independent, equally required Windows x64 and Linux x64
jobs that stage each host's runtime payload and run every quality check plus a
production build. The release workflow builds and smoke-tests the unsigned
NSIS, AppImage, and deb artifacts in separate platform jobs, then combines
their platform assets under one checksum manifest and prepares a draft pre-release.
Code signing is planned after the project is accepted by an
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
