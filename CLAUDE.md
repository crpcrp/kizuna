# Kizuna

Kizuna is an Electron and TypeScript video player for Japanese learning. It uses
mpv for playback, MeCab for tokenization, Yomitan dictionaries, AnkiConnect, and
WaniKani.

Follow the repository guidelines in [AGENTS.md](AGENTS.md):

@AGENTS.md

## Architecture

mpv, FFmpeg, and MeCab run as spawned subprocesses rather than linked libraries.
The mpv controller communicates over a Windows named pipe and embeds the player
window with `--wid`. Preserve these process boundaries; they are important for
both architecture and licensing.

Main paths:

- `src/main/`: Electron main process and service integrations.
- `src/preload/`: context bridge exposed to the renderer.
- `src/renderer/src/`: React UI and renderer state.
- `src/shared/`: types and constants shared across processes.
- `test/`: tests, with external-boundary fakes in `test/harness/` and fixtures
  in `test/fixtures/`.

Every IPC channel is declared in `src/shared/ipcChannels.ts`. Tests generally
mirror source paths and import through the `@src/` and `@test/` aliases.

Renderer components own their CSS files. Colors come from semantic variables in
`src/renderer/src/theme.css`.

Use `docs/codebase-map.md` for navigation, `docs/architecture-plan.md` for
architectural decisions, `docs/binaries.md` for external tools,
`docs/licensing.md` for redistribution requirements, and `docs/game-ocr.md` for
the experimental Windows Game OCR flow.
