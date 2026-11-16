# Kizuna Architecture

Kizuna is a Windows/Linux Electron app; [the codebase map](codebase-map.md) lists owners.

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

At launch, `src/main/startupDecision.ts` resolves the persisted startup mode
once, before mpv or the main renderer surface is started. An explicit video
path and the packaged startup probe force the player path. Splash starts only
the renderer shell; supported Windows Game OCR starts its runtime without mpv;
an OCR startup error presents Options so the user can recover.

## Playback and subtitles

Windows embeds mpv in one transparent frameless window; Linux uses a Unix
socket instead of a named pipe and an X11 `videoHost`/`uiOverlay` pair.
`mpv/ipcEndpoint.ts` owns endpoint selection and Linux socket cleanup.
`windowPair.ts` presents one lifecycle and control interface on both platforms.

On Linux, mpv's `--wid` targets the opaque host. React, preload, controls, and
selectable DOM subtitles live in the transparent overlay. Renderer measurements
of painted surfaces feed `BrowserWindow.setShape`, exposing video through native
holes rather than unreliable compositor alpha blending. Parent/child ordering
raises the host and places the overlay directly above it; ordinary playback does
not use global always-on-top.

The overlay owns user movement/resizing; the host owns fullscreen and taskbar
surfaces. Changes are coalesced, synchronized from the changed side, and guarded
against recursive mirroring. Fullscreen restores one saved rectangle after the
native leave event and publishes one logical transition. Mini-player bounds and
requested always-on-top apply to both windows together.

Subtitles are extracted separately for selection, tokenization, and knowledge
styling. Executables resolve through [runtime paths](binaries.md); subprocess
output is bounded and long operations use cancellation or timeouts where needed.

## Game OCR (Windows only, experimental)

A separate sandboxed frozen-frame window covers the captured game independently
of the player window pair. Main owns shortcuts, target geometry, tray, and the
spawned PP-OCR JSONL sidecar. Its restricted preload passes validated serializable
capture requests, PNG bytes, and normalized text regions; native handles and
worker output stay in main. The window and capture services reject other platforms.

### The one in-process native boundary

`services/gameOcr/foregroundWindow.ts` calls Windows foreground-window, process,
and DWM APIs through MIT-licensed Koffi. Electron cannot identify another process's
foreground window. Handles, never titles, identify capture targets. This links only
OS APIs, not a third-party player or OCR engine; `ForegroundWindowNative` permits
fake-based tests. An unusable native query falls back to display capture.

The renderer retains streams, draws before encoding, and sends PNG bytes to main;
base64 exists only at worker stdin. Session IDs reject stale asynchronous results.
See [Game OCR](game-ocr.md) for capture retention, input behavior, privacy, and
manual verification, and [binaries](binaries.md#game-ocr-windows-only) for the payload.

## Local data

Kizuna stores dictionaries and vocabulary knowledge in separate SQLite
databases. Settings and media history are also local. WaniKani tokens use
Electron safe storage when available; the UI warns when the operating system
cannot provide encrypted storage.

Jimaku's fixed-origin client, encrypted local credential, sender-scoped sessions,
and managed download cache belong to main; only normalized results and validated
selections cross preload. [Jimaku](jimaku.md) owns setup, offline restore, and
request privacy. [Translation setup](game-ocr.md#translation-setup) owns Azure
resource, region, and authentication requirements.

Application updates are also main-process-owned. One service uses the packaged
electron-builder GitHub configuration, keeps download and installation behind
separate user actions, and publishes only a serializable state snapshot through
the preload bridge. It checks automatically once at application startup and does
not schedule repeated checks; later checks require an explicit manual action. The
renderer never receives update URLs, credentials, cache paths, or installer paths.
Unpackaged and unknown package formats remain offline and report an unsupported
state.

## Packaging

Windows x64 NSIS and Ubuntu 24.04 x64 AppImage/deb use separate immutable
vendor payloads staged into `resources/`. Only the selected platform's tools and
notices ship. Linux mpv/FFmpeg use pinned Ubuntu shared libraries; MeCab carries
its loader/library/dictionary layout. Launchers select X11/XWayland automatically.
`better-sqlite3` is rebuilt for the host Electron ABI.

[Contributing](../CONTRIBUTING.md) owns CI checks; [Releasing](releasing.md) owns
package smoke tests, draft pre-releases, checksums, provenance, and signing status.
See [binaries](binaries.md) and [licensing](licensing.md) for pinned payload metadata.
