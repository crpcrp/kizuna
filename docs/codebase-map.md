# Kizuna Codebase Map

Kizuna uses Electron, TypeScript, React, Vite, Vitest, and SQLite. Start here to
find the owner of a change; use code search for the exact function or test.

## Top-level layout

| Path | Purpose |
|---|---|
| `src/main/` | Electron main process, IPC handlers, subprocesses, storage, and network services |
| `src/preload/` | Typed bridge exposed to the renderer |
| `src/renderer/src/` | React UI, renderer state, and styles |
| `src/shared/` | Types, validation, constants, and IPC contracts shared across processes |
| `test/` | Unit and integration tests |
| `test/harness/` | Fakes for external processes and services |
| `test/fixtures/` | Committed test data |
| `scripts/` | Resource fetching, notice generation, and test tooling |
| `docs/` | Architecture, binaries, licensing, and release documentation |

The complete renderer-facing API is `src/shared/preloadApi.ts`, implemented by
`src/preload/index.ts`. IPC channel names live in
`src/shared/ipcChannels.ts`.

## Feature ownership

| Area | Renderer/shared | Main process |
|---|---|---|
| Application shell and window | `App.tsx`, `components/WindowChrome.tsx`, `state/appChrome.ts`, `state/windowSizing.ts`, `state/usePlayerEvents.ts`, `shared/windowBounds.ts` | `index.ts`, `appLifecycle.ts`, `windowOptions.ts` |
| Playback and player controls | `components/BottomBar.tsx`, `components/MenuBar.tsx`, `state/playerAdapter.ts`, `state/playbackCommands.ts`, `state/keyActions.ts`, `state/perFileOffsets.ts`, `shared/playerSettings.ts` | `playerBridge.ts`, `mpv/controller.ts`, `mpv/ipcClient.ts` |
| Media loading and subtitles | `state/mediaOpen.ts`, `state/trackSelection.ts`, `state/dropHandling.ts`, `shared/track.ts`, `shared/cue.ts`, `shared/mediaFileTypes.ts` | `mediaBridge.ts`, `mediaService.ts`, `media/ffprobe.ts`, `media/ffmpeg.ts`, subtitle parsers |
| Playlists and history | `components/PlaylistSidebar.tsx`, `state/playlistController.ts`, `state/playlistAppend.ts`, `state/recentFilesController.ts`, `shared/m3u.ts`, `shared/mediaHistory.ts` | `mediaHistoryBridge.ts`, `services/mediaHistory.ts`, `services/folderNavigation.ts` |
| Tokenization | `state/useVocabularyPipeline.ts`, `shared/token.ts`, `shared/mecab.ts` | `mecabBridge.ts`, `services/mecab/` |
| Dictionaries and word lookup | `components/WordPopup.tsx`, dictionary options, `shared/dictionary.ts` | `dictBridge.ts`, `services/dict/` |
| Knowledge tracking | subtitle components, knowledge options, `shared/knowledge.ts` | `knowledgeBridge.ts`, `services/knowledge/` |
| Anki card creation | word and subtitle-report UI, Anki options, `shared/anki.ts` | `ankiBridge.ts`, `services/anki/` |
| Network media and subtitles | `components/OpenUrlDialog.tsx`, `state/urlSubtitleController.ts`, `shared/urlSubtitles.ts` | `urlSubtitleBridge.ts`, `services/urlSubtitles.ts`, mpv URL handling |
| Settings and appearance | `components/OptionsMenu.tsx`, `state/optionsData.ts`, `state/playerState.ts`, `state/themeController.ts` | `playerSettingsBridge.ts`, `services/settings.ts`, `services/secrets.ts` |
| Packaging and identity | `shared/appIdentity.json`, `shared/appIdentity.ts` | `appIdentity.ts`, `resourcePaths.ts`, `electron-builder.cjs` |

Renderer paths in the table are relative to `src/renderer/src/`; shared and
main paths are relative to `src/`.

Tests normally mirror source ownership. Search `test/` for the source basename
when several focused tests cover one area.

## Common changes

### Add an IPC operation

1. Declare the channel in `src/shared/ipcChannels.ts`.
2. Add request and response types or validation under `src/shared/`.
3. Register the main-process handler in the owning bridge.
4. Expose the smallest required method from `src/preload/index.ts`.
5. Add bridge and service tests.

### Add an external boundary

Keep the production adapter in the main process behind a narrow injected
interface. Tests should use a fake in `test/harness/` or a committed fixture,
not a live binary, account, or network service.

### Add persisted settings

Define defaults and normalization in `src/main/services/settings.ts`, preserve
backward compatibility, expose the change through the settings bridge, and
cover malformed input and round-tripping.

### Add renderer behavior

Put reusable components under `components/` and pure transitions or
controllers under `state/`. Keep `App.tsx` focused on composition. Use
semantic colors from `theme.css` rather than adding isolated color literals.

### Update runtime binaries

Update `resources.lock.json` and `third-party.json` together, then run
`npm run resources`, `npm run notices`, and `npm test`. See
[Runtime binaries](binaries.md) and [Licensing](licensing.md).

### Change CI or releases

Keep third-party GitHub Actions pinned to commit SHAs. CI configuration is in
`.github/workflows/ci.yml`; signed packaging is in
`.github/workflows/release.yml`.
