# Main process

Rules that differ inside `src/main/`. The repository-wide principles stay in
[AGENTS.md](../../AGENTS.md); file ownership is in
[docs/codebase-map.md](../../docs/codebase-map.md).

- A `*Bridge.ts` module only registers IPC handlers for a channel declared in
  `src/shared/ipcChannels.ts`, validates the request, and delegates. Behavior
  belongs in `services/` (or `media/`, `mpv/`), which must stay callable
  without Electron.
- Keep every external boundary — mpv, FFmpeg/ffprobe, MeCab, AnkiConnect,
  WaniKani, SQLite, Win32, `electron-updater` — behind a narrow injected
  interface so tests can pass a fake from `test/harness/`.
- Do not import `node:path` directly when deriving a user-visible path. Take an
  optional `platform` and resolve through `pathApiFor` in `platformPath.ts`; see
  "Derive a filesystem path" in the codebase map.
- Platform differences (Windows named pipe and single transparent window versus
  Linux socket endpoint and X11 host/overlay pair) live in `mpv/ipcEndpoint.ts`
  and `windowPair.ts` behind one interface. Do not spread `process.platform`
  branches into callers.
- Runtime binaries resolve only through `resourcePaths.ts`.
