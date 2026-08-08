# Kizuna (絆)

Kizuna is a Windows-first video player for Japanese learners, with built-in
vocabulary knowledge tracking and bulk Anki card extraction from subtitles.

Watch a video, see which words you already know, look up unfamiliar vocabulary,
and turn useful lines into study cards without leaving the player.

Download links for published Windows builds are available on the
[Releases page](../../releases).

## Features

- Play local video with embedded or external subtitles.
- Read selectable, tokenized Japanese subtitles over the video or in a sidebar.
- Track vocabulary knowledge and highlight words by knowledge level.
- Review vocabulary across an entire subtitle track and create Anki cards in
  bulk.
- Look up words with imported offline Yomitan dictionaries.
- Resume playback, restore subtitle and audio tracks, and navigate recent files.
- Use playlists, A–B looping, frame stepping, screenshots, mini-player mode, and
  configurable keyboard shortcuts.
- Optionally translate whole subtitle lines or open network streams.

## Requirements

Kizuna currently publishes builds for 64-bit Windows 10 or newer. Building
from source requires Node.js 24 or newer and npm. Windows uses local runtime
copies under `resources/`; unpackaged Linux development uses the
distribution's `mpv`, FFmpeg/ffprobe, and MeCab commands.

See [Binary setup](docs/binaries.md) for download sources, expected paths, and
version checks.

### Linux source development

Kizuna does not publish a Linux package yet. On Ubuntu 24.04, install Node.js
24 and the native build/runtime dependencies, then use the normal npm
workflow:

```bash
sudo apt update
sudo apt install -y build-essential python3 pkg-config mpv ffmpeg mecab mecab-ipadic-utf8 yt-dlp
npm ci
npm run dev
```

Use a checkout on the Linux filesystem and do not reuse a `node_modules`
directory produced on Windows; Electron and `better-sqlite3` contain
platform-specific binaries. Kizuna selects Electron's X11/XWayland backend
before startup, so no command-line wrapper is required. To run the production
bundle locally, use `npm run build && npm start`.

## Optional services

- **AnkiConnect** enables individual and bulk card creation plus Anki knowledge
  sync. Its default endpoint is `http://127.0.0.1:8765`.
- **WaniKani** knowledge sync requires a personal access token, stored with
  Electron safe storage when available.

Neither service is required for video playback or local subtitle study.

## Privacy and network access

Playback, subtitle processing, dictionaries, settings, history, and vocabulary
data stay on the computer. Kizuna has no telemetry, analytics, account system,
automatic crash upload, or background update checks.

Network access occurs only when you choose a network feature: opening a remote
URL, translating a subtitle, syncing WaniKani, or using AnkiConnect. A remote
AnkiConnect endpoint receives mined text and media; plain HTTP does not encrypt
that traffic.

Report security problems privately as described in
[SECURITY.md](SECURITY.md). Never post credentials or private data in an issue.

## Development

Install dependencies and start the development app:

```powershell
npm install
npm run dev
```

To build once and run the production preview:

```powershell
npm run build
npm start
```

## Testing

Run the standard checks:

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
```

Use `npm run test:watch` while iterating locally. CI runs the standard checks
for pull requests.

## Build and packaging

```powershell
npm run build  # Production build in out/
npm run dist   # Windows NSIS installer in dist/
```

Packaging uses the runtime binaries in `resources/` and generates the required
third-party notices. Published pre-releases are built by the release workflow
and are currently unsigned; Windows will show an unknown-publisher warning. See
[Binary setup](docs/binaries.md),
[Licensing and notices](docs/licensing.md), and
[Releasing](docs/releasing.md) for details.

## Project documentation

- [Contributing](CONTRIBUTING.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)
- [Architecture](docs/architecture-plan.md)
- [Codebase map](docs/codebase-map.md)
- [Binary setup](docs/binaries.md)
- [Licensing and notices](docs/licensing.md)
- [Releasing](docs/releasing.md)

## License

Copyright (C) 2026 Adam Kocsis.

Kizuna is free software licensed under
[GPL-3.0-or-later](LICENSE), without warranty. Bundled third-party components
remain under their own licenses; their notices and corresponding-source
information ship with the application and are documented in
[docs/licensing.md](docs/licensing.md).
