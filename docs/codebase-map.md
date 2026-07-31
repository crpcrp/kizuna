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
| Application shell and window | `App.tsx`, `components/WindowChrome.tsx`, `state/usePlaybackWindow.ts`, `state/appChrome.ts`, `state/windowSizing.ts`, `state/useVideoMargins.ts`, `state/useMiniPlayer.ts`, `state/usePlayerEvents.ts`, `shared/windowBounds.ts` | `index.ts`, `appLifecycle.ts`, `windowOptions.ts` |
| Playback and player controls | `state/usePlaybackWindow.ts`, `components/BottomBar.tsx`, `components/MenuBar.tsx`, `state/playerAdapter.ts`, `state/playbackCommands.ts`, `state/keyActions.ts`, `state/perFileOffsets.ts`, `state/usePerFileRestore.ts`, `state/audioDevices.ts`, `shared/playerSettings.ts` | `playerBridge.ts`, `mpv/controller.ts`, `mpv/ipcClient.ts` |
| Media loading and subtitles | `state/useMediaSession.ts`, `state/mediaOpen.ts`, `state/trackSelection.ts`, `state/dropHandling.ts`, `shared/track.ts`, `shared/cue.ts`, `shared/mediaFileTypes.ts` | `mediaBridge.ts`, `mediaService.ts` (composition root), `media/mediaPicker.ts`, `media/subtitleService.ts`, `media/metadataService.ts`, `media/thumbnailPreview.ts`, `media/ffprobe.ts`, `media/ffmpeg.ts`, subtitle parsers |
| Seekbar hover thumbnails | `state/seekPreview.ts`, `components/SeekPreview.tsx` | `media/thumbnailPreview.ts`, `services/thumbnails/generation.ts`, `services/thumbnails/cache.ts`, `services/thumbnails/nodeFs.ts` |
| Playlists and history | `state/useMediaSession.ts`, `components/PlaylistSidebar.tsx`, `state/playlistController.ts`, `state/playlistAppend.ts`, `state/recentFilesController.ts`, `shared/m3u.ts`, `shared/mediaHistory.ts` | `mediaHistoryBridge.ts`, `services/mediaHistory.ts`, `services/folderNavigation.ts` |
| Tokenization | `state/useVocabularyCaches.ts`, `state/useVocabularyPipeline.ts`, `shared/token.ts`, `shared/mecab.ts` | `mecabBridge.ts`, `services/mecab/` |
| Dictionaries and word lookup | `state/useWordPopup.ts`, `components/WordPopup.tsx`, `state/popupController.ts`, `state/wordLookup.ts`, dictionary options, `shared/dictionary.ts` | `dictBridge.ts`, `services/dict/` |
| Knowledge tracking | `state/useKnowledgeOptions.ts`, `state/useVocabularyCaches.ts`, subtitle components, `state/knowledgeActions.ts`, knowledge options, `shared/knowledge.ts` | `knowledgeBridge.ts`, `services/knowledge/` |
| Anki card creation | `state/useWordPopup.ts`, `state/useBulkMining.ts`, `state/useSubtitleReport.ts`, word and subtitle-report UI, `state/ankiMining.ts`, `state/bulkMiningController.ts`, `state/subtitleReportController.ts`, Anki options, `shared/anki.ts` | `ankiBridge.ts`, `services/anki/` |
| Network media and subtitles | `state/useMediaSession.ts`, `components/OpenUrlDialog.tsx`, `state/urlSubtitleController.ts`, `state/ytdlpQualityReload.ts`, `shared/urlSubtitles.ts` | `urlSubtitleBridge.ts`, `services/urlSubtitles.ts`, mpv URL handling |
| Settings and appearance | `state/useOptionsDialog.ts`, `state/optionsMenuProps.ts`, `components/OptionsMenu.tsx`, `state/optionsData.ts`, `state/playerState.ts`, `state/useAppearance.ts`, `state/themeController.ts` | `playerSettingsBridge.ts`, `services/settings.ts`, `services/secrets.ts` |
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
controllers under `state/`. Keep `App.tsx` focused on composition: add the
behavior to the feature hook that already owns the workflow —
`state/useMediaSession.ts` (opening media, playlists, subtitles),
`state/usePlaybackWindow.ts` (playback commands, per-file values, panels,
window sizing, mini player), `state/useVocabularyMining.ts` (which composes
the vocabulary subjects — `state/useVocabularyCaches.ts` for the
tokenization/knowledge caches it drives through
`state/useVocabularyPipeline.ts`, `state/useWordPopup.ts` for the popup and its
Anki mine, `state/useSubtitleReport.ts`, `state/useBulkMining.ts`, and
`state/useKnowledgeOptions.ts` for the Options rows that invalidate those
caches), or
`state/useOptionsDialog.ts` (the Options dialog, its optional-integration data,
and the dictionary/Anki actions that refresh it) — rather than to the root
component. A new Options row is wired in `state/optionsMenuProps.ts`, next to
the rest of the dialog's props. Use semantic colors from `theme.css` rather
than adding isolated color literals.

### Update runtime binaries

Update `resources.lock.json` and `third-party.json` together, then run
`npm run resources`, `npm run notices`, and `npm test`. See
[Runtime binaries](binaries.md) and [Licensing](licensing.md).

### Change CI or releases

Keep third-party GitHub Actions pinned to commit SHAs. CI configuration is in
`.github/workflows/ci.yml`; signed packaging is in
`.github/workflows/release.yml`.
