# Kizuna Codebase Map

Kizuna uses Electron, TypeScript, React, Vite, Vitest, and SQLite.
[Architecture](architecture.md) describes process boundaries; [AGENTS.md](../AGENTS.md)
and scoped guidelines in `src/main/`, `src/renderer/`, `scripts/`, and `test/` govern changes.

## Layout

| Path | Purpose |
|---|---|
| `src/main/` | IPC, subprocesses, storage, network, native windows |
| `src/preload/` | Typed renderer bridges |
| `src/renderer/src/` | React, state, CSS |
| `src/shared/` | Contracts, validation, constants |
| `test/` | Mirrored source tests, harness, fixtures |
| `scripts/` | Resources, notices, packaging, test launcher |
| `docs/` | Contributor and user references |

## Feature ownership

Renderer paths are relative to `src/renderer/src/`, main paths to `src/main/`,
and `shared/` paths to `src/`; `/` marks repository-root paths. Search tests by source basename.

| Area | Renderer/shared | Main process |
|---|---|---|
| Application shell and window | `App.tsx`, `components/WindowChrome.tsx`, `state/usePlaybackWindow.ts`, `state/useVideoWindowSizing.ts`, `state/windowSizing.ts`, `state/useVideoMargins.ts`, `state/useMiniPlayer.ts`, `state/usePlayerEvents.ts`, `shared/windowBounds.ts` | `index.ts`, `bootstrap/`, `bootstrap/window.ts`, `appLifecycle.ts`, `windowOptions.ts`, `windowPair.ts` |
| Playback and player controls | `state/usePlaybackWindow.ts`, `state/useVideoWindowSizing.ts`, `components/BottomBar.tsx`, `components/MenuBar.tsx`, `state/playerAdapter.ts`, `state/playbackCommands.ts`, `state/keyActions.ts`, `state/perFileOffsets.ts`, `state/usePerFileRestore.ts`, `state/audioDevices.ts`, `shared/playerSettings.ts` | `playerBridge.ts`, `mpv/controller.ts`, `mpv/ipcClient.ts` |
| Media loading and subtitles | `state/useMediaSession.ts`, `state/mediaOpen.ts`, `state/trackSelection.ts`, `state/dropHandling.ts`, `shared/track.ts`, `shared/cue.ts`, `shared/mediaFileTypes.ts` | `mediaBridge.ts`, `mediaService.ts`, `media/mediaPicker.ts`, `media/subtitleService.ts`, `media/metadataService.ts`, `media/thumbnailPreview.ts`, `media/ffprobe.ts`, `media/ffmpeg.ts` |
| Jimaku subtitle discovery and export | `shared/jimaku.ts`, `shared/jimakuMatching.ts`, `state/jimakuController.ts`, `state/jimaku/`, `components/JimakuSubtitlesDialog.tsx`, `components/jimaku/`, `components/NoJapaneseSubtitlePrompt.tsx` | `services/jimaku/`, `jimakuBridge.ts`, `jimakuSettingsBridge.ts` |
| Seekbar hover thumbnails | `state/seekPreview.ts`, `components/SeekPreview.tsx` | `media/thumbnailPreview.ts`, `services/thumbnails/generation.ts`, `services/thumbnails/cache.ts` |
| Playlists and history | `state/useMediaSession.ts`, `components/PlaylistSidebar.tsx`, `state/playlistController.ts`, `state/recentFilesController.ts`, `shared/m3u.ts`, `shared/mediaHistory.ts` | `mediaHistoryBridge.ts`, `services/mediaHistory.ts`, `services/mediaHistoryStore.ts`, `services/folderNavigation.ts` |
| Tokenization | `state/useVocabularyPipeline.ts`, `state/tokenization.ts`, `shared/token.ts`, `shared/mecab.ts`, `shared/textProjection.ts` | `mecabBridge.ts`, `services/mecab/` |
| Dictionaries and word lookup | `state/useWordPopup.ts`, `components/WordPopup.tsx`, `state/popupController.ts`, `state/wordLookup.ts`, `shared/dictionary.ts` | `dictBridge.ts`, `services/dict/` |
| Grammar chain and Tatoeba examples | `shared/inflection.ts`, `shared/grammarExamples.ts`, `state/useGrammarExamples.ts`, `state/useTatoebaExamples.ts`, `components/options/TatoebaExamplesSection.tsx` | `grammarExamplesBridge.ts`, `services/grammarExamples/` (download, worker build, lookup) |
| Knowledge tracking and JLPT coverage/export | `state/useKnowledgeOptions.ts`, `state/useVocabularyPipeline.ts`, `state/knowledgeActions.ts`, `shared/knowledge.ts`, `shared/jlptCoverage.ts`, `shared/jlptExport.ts` | `knowledgeBridge.ts`, `services/knowledge/service.ts`, `services/knowledge/`, `services/jlpt/` |
| Subtitle sidebar | `components/SubtitleSidebar.tsx`, `components/SubtitleTranslationPopup.tsx`, `state/sidebarSearch.ts`, `state/subtitleSearchDebounce.ts`, `state/sidebarTranslation.ts`, `state/useSidebarTranslation.ts` | — |
| Azure translation | `components/options/SubtitlesTab.tsx`, `state/integrationActions.ts`, `state/optionsData.ts`, `shared/translation.ts` | `translateBridge.ts`, `translationSettingsBridge.ts`, `services/translate/azureTranslate.ts`, `services/translate/translationSettings.ts` |
| Anki card creation | `state/useWordPopup.ts`, `state/useBulkMining.ts`, `state/useSubtitleReport.ts`, `state/ankiMining.ts`, `state/bulkMiningController.ts`, `state/subtitleReportController.ts`, `shared/anki.ts` | `ankiBridge.ts`, `services/anki/service.ts`, `services/anki/jlptBackfillService.ts` |
| Settings and appearance | `state/useOptionsDialog.ts`, `state/optionsMenuProps.ts`, `state/optionsData.ts`, `state/integrationActions.ts`, `components/OptionsMenu.tsx`, `components/options/SubtitlesTab.tsx`, `state/playerState.ts`, `state/rendererSettings.ts`, `state/useSettingsLifecycle.ts`, `state/settingsPersistence.ts`, `state/useAppearance.ts` | `playerSettingsBridge.ts`, `services/settings.ts`, `services/secrets.ts` |
| Game OCR (Windows, experimental) | `gameOcr.tsx`, `state/useGameOcrSession.ts`, `state/gameOcrBoxRegions.ts`, `state/gameOcrLayout.ts`, `state/gameOcrCaptureStream.ts`, `state/gameOcrTextPipeline.ts`, `state/gameOcrSelection.ts`, `state/useGameOcrTranslation.ts`, `components/GameOcrFrame.tsx`, `components/GameOcrBoxes.tsx`, `components/GameOcrInteraction.tsx`, `state/useGameOcr.ts`, `components/options/GameOcrTab.tsx`, `shared/ocr.ts`, `shared/gameOcr.ts`, `shared/gameOcrSettings.ts` | `gameOcrBridge.ts`, `services/gameOcr/`, `services/ocr/`, `bootstrap/gameOcr.ts`, `resourcePaths.ts` |
| Packaging and startup | `shared/appIdentity.json`, `shared/appIdentity.ts` | `appIdentity.ts`, `startupDecision.ts`, `resourcePaths.ts`, `bootstrap/paths.ts`, `startupProbe.ts`, `/electron-builder.cjs`, `/scripts/linuxPackaging.mjs`, `/scripts/smoke-linux-package.mjs` |
| Application updates | `AppShell.tsx`, `state/useUpdates.ts`, `state/updateController.ts`, `components/UpdateNotifications.tsx`, `components/UpdateDialog.tsx`, `shared/update.ts`, `shared/preloadApi.ts` | `updateSupport.ts`, `electronUpdaterAdapter.ts`, `updaterErrors.ts`, `updateService.ts`, `updateBridge.ts`, `bootstrap/updates.ts` |

## Common changes

### Add an IPC operation

1. Declare the channel in `src/shared/ipcChannels.ts` and types/guards in `src/shared/`.
2. In the owning `*Bridge.ts`, narrow `unknown` arguments with `expect(guard, channel)`
   from `ipcValidation.ts`, then delegate to a service callable without Electron.
3. Expose the smallest method through `src/shared/preloadApi.ts` and `src/preload/index.ts`.
4. Test service behavior, one malformed case per guard shape, and bridge-owned sender
   scoping, cancellation, progress, or error mapping. Avoid forwarding-only tests.

### Add an external boundary

Keep processes, network, SQLite, Win32, and updater adapters behind narrow injected
interfaces in main. Use the shared harness listed in [test guidelines](../test/AGENTS.md)
or committed fixtures. Test filesystem behavior in temporary directories.

### Derive a filesystem path

Take `platform: NodeJS.Platform = process.platform` (or an optional dependency field)
and use `pathApiFor` from `src/main/platformPath.ts` rather than host `node:path`.
Assert both Windows and Linux with `describe.each(PATH_PLATFORMS)` from
`test/harness/platformPaths.ts`. Never resolve Windows fixtures with the host's
path API. Skip a platform only for a named technical reason with counterpart coverage.

### Add persisted settings

Add type/default in `shared/playerSettings.ts`, normalization in `main/services/settings.ts`,
and a settings-test row. For reducer-backed values, add the key to `SYNCED_SETTING_KEYS`
in `state/rendererSettings.ts`; type, initial state, loading, and persistence follow.
Options tabs use `settings` and `onChange({ field: value })`. Keep named reducer
transitions for merging or validation. Reuse guards from `src/shared/guards.ts`.

### Change Game OCR

- Player entry: `src/renderer/index.html` → `src/main.tsx`; frozen frame: `src/renderer/gameOcr.html` → `src/gameOcr.tsx` (paths after arrows relative to `src/renderer/`). Declare entries in `electron.vite.config.ts`.
- Frozen-frame API: `KizunaGameOcrApi` in `src/shared/preloadApi.ts`, implemented by `src/preload/gameOcr.ts`; both preloads build as sandboxed single files.
- Lifecycle and shortcuts: `services/gameOcr/controller.ts`, `shortcuts.ts`; sessions and stale-result rejection: `captureSession.ts`.
- Target selection: `captureTarget.ts`, `foregroundWindow.ts`, `windowCapture.ts`, `displayCapture.ts`; native window: `frozenFrameController.ts`, `frozenFrameElectron.ts`.
- User behavior, design constraints, and manual checks: [Game OCR](game-ocr.md).

### Change packaging or releases

Runtime lookup belongs to `src/main/resourcePaths.ts`; staging and lock validation
belong to `scripts/vendorResources.mjs` and `scripts/fetch-resources.mjs`.
Follow [binary updates](binaries.md#updating-a-pinned-binary) and [licensing](licensing.md).
CI and releases live in `.github/workflows/`; pin external Actions to full commit SHAs.
`electron-builder.cjs` owns both packages. Linux smoke checks use
`scripts/smoke-linux-package.mjs` and `scripts/linuxPackaging.mjs`.
`src/main/startupProbe.ts` reports GUI startup milestones when `KIZUNA_STARTUP_PROBE=1`.
See [Releasing](releasing.md) for commands and signing status.
