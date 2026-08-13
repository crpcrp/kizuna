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
| `scripts/` | Resource fetching, notice generation, Linux packaging verification, and test tooling |
| `docs/` | Architecture, binaries, licensing, release, and Game OCR documentation |

The complete renderer-facing API is `src/shared/preloadApi.ts`, implemented by
`src/preload/index.ts`. IPC channel names live in
`src/shared/ipcChannels.ts`.

## Feature ownership

| Area | Renderer/shared | Main process |
|---|---|---|
| Application shell and window | `App.tsx`, `components/WindowChrome.tsx`, `state/usePlaybackWindow.ts`, `state/appChrome.ts`, `state/windowSizing.ts`, `state/useVideoMargins.ts`, `state/useMiniPlayer.ts`, `state/usePlayerEvents.ts`, `shared/windowBounds.ts` | `index.ts`, `appLifecycle.ts`, `windowOptions.ts`, `windowPair.ts` (window creation, source-aware host/overlay coordination, lifecycle, fullscreen, and IPC target mapping) |
| Playback and player controls | `state/usePlaybackWindow.ts`, `components/BottomBar.tsx`, `components/MenuBar.tsx`, `state/playerAdapter.ts`, `state/playbackCommands.ts`, `state/keyActions.ts`, `state/perFileOffsets.ts`, `state/usePerFileRestore.ts`, `state/audioDevices.ts`, `shared/playerSettings.ts` | `playerBridge.ts`, `mpv/controller.ts`, `mpv/ipcClient.ts` |
| Media loading and subtitles | `state/useMediaSession.ts`, `state/mediaOpen.ts`, `state/trackSelection.ts`, `state/dropHandling.ts`, `shared/track.ts`, `shared/cue.ts`, `shared/mediaFileTypes.ts` | `mediaBridge.ts`, `mediaService.ts` (composition root), `media/mediaPicker.ts`, `media/subtitleService.ts`, `media/metadataService.ts`, `media/thumbnailPreview.ts`, `media/ffprobe.ts`, `media/ffmpeg.ts`, subtitle parsers |
| Seekbar hover thumbnails | `state/seekPreview.ts`, `components/SeekPreview.tsx` | `media/thumbnailPreview.ts`, `services/thumbnails/generation.ts`, `services/thumbnails/cache.ts`, `services/thumbnails/nodeFs.ts` |
| Playlists and history | `state/useMediaSession.ts`, `components/PlaylistSidebar.tsx`, `state/playlistController.ts`, `state/playlistAppend.ts`, `state/recentFilesController.ts`, `shared/m3u.ts`, `shared/mediaHistory.ts` | `mediaHistoryBridge.ts`, `services/mediaHistory.ts`, `services/folderNavigation.ts` |
| Tokenization | `state/useVocabularyCaches.ts`, `state/useVocabularyPipeline.ts`, `shared/token.ts`, `shared/mecab.ts` | `mecabBridge.ts`, `services/mecab/` |
| Dictionaries and word lookup | `state/useWordPopup.ts`, `components/WordPopup.tsx`, `state/popupController.ts`, `state/wordLookup.ts`, dictionary options, `shared/dictionary.ts` | `dictBridge.ts`, `services/dict/` |
| Knowledge tracking | `state/useKnowledgeOptions.ts`, `state/useVocabularyCaches.ts`, subtitle components, `state/knowledgeActions.ts`, knowledge options, `shared/knowledge.ts` | `knowledgeBridge.ts`, `services/knowledge/` |
| Subtitle sidebar | `components/SubtitleSidebar.tsx` (cue rows and search), `components/SubtitleTranslationPopup.tsx`, `state/sidebarSearch.ts`, `state/subtitleSearchDebounce.ts`, `state/sidebarTranslation.ts`, `state/useSidebarTranslation.ts` | — |
| Anki card creation | `state/useWordPopup.ts`, `state/useBulkMining.ts`, `state/useSubtitleReport.ts`, word and subtitle-report UI, `state/ankiMining.ts`, `state/bulkMiningController.ts`, `state/subtitleReportController.ts`, Anki options, `shared/anki.ts` | `ankiBridge.ts`, `services/anki/` |
| Settings and appearance | `state/useOptionsDialog.ts`, `state/optionsMenuProps.ts`, `components/OptionsMenu.tsx`, `state/optionsData.ts`, `state/playerState.ts`, `state/rendererSettings.ts` (which persisted fields the renderer syncs, and who owns the rest), `state/useSettingsLifecycle.ts`, `state/settingsPersistence.ts`, `state/useAppearance.ts`, `state/themeController.ts` | `playerSettingsBridge.ts`, `services/settings.ts`, `services/secrets.ts` |
| Game OCR (Windows, experimental) | `gameOcr.tsx` and `gameOcr.html` (the second renderer entry), `state/useGameOcrSession.ts`, `state/gameOcrBoxRegions.ts`, `state/gameOcrLayout.ts`, `state/gameOcrCaptureStream.ts` (retained capture streams), `state/gameOcrTextPipeline.ts`, `state/gameOcrSelection.ts`, `state/useGameOcrTranslation.ts`, `components/GameOcrFrame.tsx`, `components/GameOcrBoxes.tsx`, `components/GameOcrInteraction.tsx`, `state/useGameOcr.ts` and `components/options/GameOcrTab.tsx` (the player window's controls), `shared/ocr.ts`, `shared/gameOcr.ts`, `shared/gameOcrSettings.ts` | `gameOcrBridge.ts`, `services/gameOcr/controller.ts` (sessions, hotkey, recapture order), `services/gameOcr/captureTarget.ts` (focused window or display fallback), `services/gameOcr/foregroundWindow.ts` (the Win32 boundary), `services/gameOcr/windowCapture.ts` (source ids, physical-to-logical geometry), `services/gameOcr/displayCapture.ts`, `services/gameOcr/frozenFrameWindow.ts`, `services/gameOcr/runtime.ts`, `services/gameOcr/backgroundLifecycle.ts`, `services/gameOcr/tray.ts`, `services/ocr/ppOcrWorker.ts`, `resourcePaths.ts` (bundled payload) |
| Packaging and identity | `shared/appIdentity.json`, `shared/appIdentity.ts` | `appIdentity.ts`, `resourcePaths.ts`, `startupProbe.ts`, `electron-builder.cjs`, `scripts/linuxPackaging.mjs`, `scripts/smoke-linux-package.mjs` |
| Application updates | `shared/update.ts`, typed `preloadApi.ts` surface | `updateSupport.ts`, `electronUpdaterAdapter.ts`, `updaterErrors.ts`, `updateService.ts`, `updateBridge.ts`, lifecycle composition in `index.ts` |

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

Reach for the shared harness before writing a local fake or fixture:
`fakeIpcMain.ts` (records the handlers a bridge registers), `fakeSettingsIo.ts`
(in-memory settings file), `deferred.ts` (a promise the test settles),
`dictFixtures.ts` (`makeLookupResult`, `makeDictInfo`),
`fakeKizunaApi.ts` (the typed preload API), and `platformPaths.ts`
(Windows/Linux path cases). Extend one of these rather than copying it, so a
change to the shape stays a single edit.

### Derive a filesystem path

Take an optional `platform: NodeJS.Platform` (or a `platform?` field on the
deps object) defaulting to `process.platform`, and resolve the path API through
`pathApiFor` in `src/main/platformPath.ts` instead of importing `join`,
`dirname`, or `basename` straight from `node:path`. Production behavior is
unchanged; tests then assert the Windows and Linux results on either host with
`describe.each(PATH_PLATFORMS)` from `test/harness/platformPaths.ts`.

Never hand a Windows-format fixture to the host's default `node:path`:
`join('C:\\Users\\me', 'Kizuna')` yields `C:\Users\me/Kizuna` on Linux, so
the assertion passes while describing a path no platform produces.

### Add persisted settings

Define defaults and normalization in `src/main/services/settings.ts`, preserve
backward compatibility, expose the change through the settings bridge, and
cover malformed input and round-tripping.

If the renderer's reducer holds the setting, add its key to
`SYNCED_SETTING_KEYS` in `state/rendererSettings.ts` and the field to
`PlayerState`; `state/useSettingsLifecycle.ts` then loads and saves it with no
further edits. A setting persisted by its own callback instead belongs in that
module's `EXTERNALLY_PERSISTED_SETTING_KEYS`, naming its owner.

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

### Change Game OCR

The experimental Windows OCR flow spans two renderers. `src/renderer/index.html`
owns only the Options tab and the Settings-menu command; the frozen frame is a
separate entry point (`src/renderer/gameOcr.html` →
`src/renderer/src/gameOcr.tsx`) that main loads into its own window, so a change
to the player's React tree does not reach it. Anything renderer-facing has to be
declared in `electron.vite.config.ts`'s renderer inputs to be built.

`services/gameOcr/controller.ts` owns session identity and the
invalidate → capture → move → replace canvas → recognize order. The native
window is excluded from Windows desktop capture, which keeps a recapture off
Kizuna's own frozen screenshot without hiding it first. The controller retains one frozen-frame
window for the whole armed run, so a frame ends by hiding rather than closing;
`services/gameOcr/frozenFrameWindow.ts` separates that discard from the close
that only stopping, a display change, or a dead renderer performs. Work that
must not survive a recapture belongs behind the session ID, not behind a
renderer-side guard, and anything a fresh renderer used to pick up at boot has
to be refreshed per frame instead.

What a shortcut captures is decided in `services/gameOcr/captureTarget.ts`,
which composes the Win32 foreground query
(`services/gameOcr/foregroundWindow.ts`), the physical-to-logical geometry
(`services/gameOcr/windowCapture.ts`), and the display-under-pointer fallback
(`services/gameOcr/displayCapture.ts`) into one discriminated target. Add a new
reason a window cannot be used to `GameOcrFallbackReason` and its text table;
every one of them has to end in a display capture rather than a failure, and
nothing on that path may throw. Native calls belong behind
`ForegroundWindowNative`, never in the rules above it, so tests keep running on
Linux. See [Game OCR](game-ocr.md) for the user-visible behavior, the measured
runtime facts the design rests on, and the manual verification matrix.

### Update runtime binaries

Platform selection and lock validation are in `scripts/vendorResources.mjs`;
`scripts/fetch-resources.mjs` is the command-line entry point and stages the
selected lock into `resources/`. Runtime lookup then lives in
`src/main/resourcePaths.ts`. Update `resources.lock.json` and
`third-party.json` together, then run the explicit platform staging commands,
`npm run notices`, and `npm test`. See
[Runtime binaries](binaries.md) and [Licensing](licensing.md).

### Change CI or releases

Keep third-party GitHub Actions pinned to commit SHAs. CI configuration is in
`.github/workflows/ci.yml`; release packaging and verification are in
`.github/workflows/release.yml`. See [Releasing](releasing.md) for the release
procedure and current signing status.

Windows and Linux packaging both live in `electron-builder.cjs`, driven by
`npm run dist` and `npm run dist:linux`. Linux artifacts are verified by
`npm run smoke:linux` (`scripts/smoke-linux-package.mjs`, with its pure
assertions in `scripts/linuxPackaging.mjs`), which runs only in the release
workflow. Anything assertable without a real build belongs in
`test/linuxPackagingConfig.test.ts` so it fails in ordinary CI instead.

The packaged GUI check waits on `src/main/startupProbe.ts`, which reports
startup milestones on stdout when `KIZUNA_STARTUP_PROBE=1`. Adding a startup
step worth waiting for means marking a new milestone there.

Use these owners when release behavior changes:

| Concern | Source of truth | Regression coverage |
|---|---|---|
| CI host matrix and required commands | `.github/workflows/ci.yml` | `test/repoConfig.test.ts` |
| Artifact targets, names, deb dependencies, desktop entry | `electron-builder.cjs` | `test/linuxPackagingConfig.test.ts` |
| Linux archive/install/startup smoke | `scripts/smoke-linux-package.mjs` and `scripts/linuxPackaging.mjs` | `test/scripts/linuxPackaging.test.ts` |
| Release job ordering, assets, checksums, provenance | `.github/workflows/release.yml` | `test/releaseWorkflow.test.ts` |
| Cross-platform path expectations | `test/harness/platformPaths.ts` | owning main/shared tests |
