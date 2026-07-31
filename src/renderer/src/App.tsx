import './theme.css'
import './App.css'
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import WindowChrome from './components/WindowChrome'
import MenuBar from './components/MenuBar'
import BottomBar from './components/BottomBar'
import OptionsMenu from './components/OptionsMenu'
import type { OptionsCategory } from './components/options/types'
import SubtitleOverlay from './components/SubtitleOverlay'
import SubtitleSidebar from './components/SubtitleSidebar'
import PlaylistSidebar from './components/PlaylistSidebar'
import SubtitleReport from './components/SubtitleReport'
import BulkMiningModal from './components/BulkMiningModal'
import VideoAdjustments from './components/VideoAdjustments'
import OpenUrlDialog from './components/OpenUrlDialog'
import CardImageCropDialog from './components/CardImageCropDialog'
import BulkMiningSidebar from './components/BulkMiningSidebar'
import WordPopup from './components/WordPopup'
import {
  playerReducer,
  initialPlayerState,
  isJapaneseSubtitleTrack,
  type PlayerState
} from './state/playerState'
import { seekTargetForCue } from './state/cueNavigation'
import { cycleAbLoopAction } from './state/playbackCommands'
import { cueKey } from './state/tokenization'
import { activeLoopCue, loopSeekTarget, replayCue, type LoopSelection } from './state/cueNavigation'
import { appClassName, toggleFromRightClick } from './state/appChrome'
import { buildPlayerAdapter } from './state/playerAdapter'
import { miniPlayerSubtitleStyle } from './state/miniPlayer'
import { createSettingsPersistence } from './state/settingsPersistence'
import { useSettingsLifecycle } from './state/useSettingsLifecycle'
import { usePlayerEvents } from './state/usePlayerEvents'
import { usePerFileValues, usePlaybackWindow } from './state/usePlaybackWindow'
import { createThemeController } from './state/themeController'
import {
  createOptionsDataController,
  DEFAULT_DICTIONARIES_DATA,
  DEFAULT_KNOWLEDGE_SETTINGS,
  DEFAULT_SYNC_STATUS,
  optionsDataBridge
} from './state/optionsData'
import {
  loadCategoryDomains,
  importYomitanDict,
  setYomitanEnabled,
  setYomitanFallbackOnly,
  reorderYomitanDicts,
  removeYomitanDict,
  changeAnkiSettings
} from './state/integrationActions'
import { createModifierTracker } from './state/keyBindings'
import { useSubtitleDrag } from './state/useSubtitleDrag'
import { useFullscreenReveal } from './state/useFullscreenReveal'
import { useKeyboardShortcuts, type KeyboardShortcutContext } from './state/useKeyboardShortcuts'
import { useLatestRef } from './state/useLatestRef'
import { useMediaSession } from './state/useMediaSession'
import { useVocabularyMining } from './state/useVocabularyMining'
import { applyLevelColors } from './util/levelColors'
import { errorMessage } from './util/errorMessage'
import type { KizunaApi } from '../../shared/preloadApi'
import { findActiveCue, offsetTimePos } from '../../shared/cue'
import type { Cue } from '../../shared/cue'
import { type AudioDevice } from '../../shared/audioDevice'
import type { ImportProgress } from '../../shared/dictionary'
import type { AnkiSettings } from '../../shared/anki'

// Root React component: the runnable player shell. Wires the reducer + the
// feature hooks that own each workflow (state/useMediaSession.ts for media,
// state/usePlaybackWindow.ts for playback and window,
// state/useVocabularyMining.ts for vocabulary and mining, and their siblings)
// into the presentational components
// (WindowChrome/MenuBar/BottomBar/SubtitleOverlay).
//
// SSR-safety: the render path never touches `window` directly. All bridge
// access is deferred to event handlers or to the useEffect subscriptions
// below (effects don't run during renderToStaticMarkup).

export interface AppProps {
  /** Optional render seed for deterministic renderer integration tests. */
  initialState?: PlayerState
  /** Optional initially-known mpv outputs for deterministic renderer integration tests. */
  initialAudioDevices?: AudioDevice[]
}

export default function App({
  initialState = initialPlayerState,
  initialAudioDevices = []
}: AppProps): React.JSX.Element {
  // `window.kizuna` doesn't exist during SSR (renderToStaticMarkup has no
  // `window` at all, not even an empty stub) — every other reference to it in
  // this component lives inside an effect/callback, deferred until the
  // browser actually calls it, but a few hook calls below need the bridge (or
  // a piece of it) as a plain argument value, evaluated immediately at render
  // time. The `{}` SSR stand-in makes property reads on it (`.player`,
  // `.windowControls`, …) resolve to `undefined` instead of throwing; that's
  // fine since those hooks only ever call through the bridge from inside an
  // effect, which never runs server-side.
  const kizuna = typeof window === 'undefined' ? ({} as unknown as KizunaApi) : window.kizuna
  const [state, dispatch] = useReducer(playerReducer, initialState)
  const playerAdapter = useMemo(() => buildPlayerAdapter(dispatch), [dispatch])
  const pausedRef = useLatestRef(state.paused)
  const reveal = useFullscreenReveal(state.fullscreen)
  const [optionsOpen, setOptionsOpen] = useState(false)
  // The per-cue loop is stored together with the cue list it was picked from,
  // so a new list (file or subtitle-track switch) drops it by derivation
  // instead of through a reset effect.
  const [loopSelection, setLoopSelection] = useState<LoopSelection | null>(null)
  const loopCue = activeLoopCue(loopSelection, state.cues)
  const setLoopCue = (cue: Cue | null): void =>
    setLoopSelection(cue ? { cues: state.cues, cue } : null)
  // True while a MenuBar dropdown is open. In fullscreen, edgeReveal only
  // tracks pointer Y against the top-controls bar's own height, so moving
  // the cursor down into a dropdown panel (which extends below that band)
  // would otherwise slide the bar away mid-click. Keeping it revealed here
  // is OR'd into the top-controls reveal below.
  const [menuBarOpen, setMenuBarOpen] = useState(false)
  const stateRef = useLatestRef(state)
  const mediaSession = useMediaSession({
    bridge: kizuna,
    dispatch,
    player: playerAdapter,
    state,
    stateRef
  })
  // Whether the all-subtitles side panel (SubtitleSidebar) is shown. Restored
  // from settings.json on mount by useSettingsLifecycle; toggled and persisted
  // by usePlaybackWindow, which also compensates the window size for it.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Whether the playlist (play-queue) side panel is shown, restored and
  // toggled exactly like sidebarOpen above.
  const [playlistOpen, setPlaylistOpen] = useState(false)
  // Options dialog's optional-integration data (MeCab/Yomitan dictionaries,
  // Anki connection + deck/model/field lists, knowledge settings + sync
  // status) — cached per-domain, isolated on failure. See state/optionsData.ts.
  const [optionsData] = useState(() => createOptionsDataController(optionsDataBridge))
  const dictionariesState = useSyncExternalStore(
    optionsData.subscribe,
    () => optionsData.getState('dictionaries'),
    () => optionsData.getState('dictionaries')
  )
  const ankiState = useSyncExternalStore(
    optionsData.subscribe,
    () => optionsData.getState('anki'),
    () => optionsData.getState('anki')
  )
  const knowledgeState = useSyncExternalStore(
    optionsData.subscribe,
    () => optionsData.getState('knowledge'),
    () => optionsData.getState('knowledge')
  )
  const setupState = useSyncExternalStore(
    optionsData.subscribe,
    () => optionsData.getState('setup'),
    () => optionsData.getState('setup')
  )
  const dictionariesData = dictionariesState.data ?? DEFAULT_DICTIONARIES_DATA
  const knowledgeSettings = knowledgeState.data?.settings ?? DEFAULT_KNOWLEDGE_SETTINGS
  const syncStatus = knowledgeState.data?.syncStatus ?? DEFAULT_SYNC_STATUS

  // Lazily loads an Options category's domain(s) when it's shown (see
  // OptionsMenu's onCategoryOpen and domainsForCategory in integrationActions),
  // instead of fetching every optional integration at app startup. A
  // cached/ready domain is a no-op; one domain's rejection never blocks the
  // others — see optionsData.ts's per-domain error isolation.
  const handleOptionsCategoryOpen = useCallback(
    (category: OptionsCategory): void => {
      loadCategoryDomains(optionsData, category)
    },
    [optionsData]
  )
  // Coalesces rapid PlayerSettings patches (subtitle-drag mousemove ticks,
  // Options-menu edits) into a single debounced write instead of one IPC
  // round-trip (and synchronous writeFileSync) per intermediate value. See
  // state/settingsPersistence.ts.
  const settingsPersistenceRef = useRef(
    createSettingsPersistence((patch) => window.kizuna.playerSettings.setSettings(patch))
  )
  // Resolves the appearance setting ('system'|'light'|'dark') to the concrete
  // theme and stamps it on <html data-theme="…">, which is what the semantic
  // CSS variables in App.css key off. In system mode it also follows OS
  // prefers-color-scheme changes — see state/themeController.ts.
  const [themeController] = useState(() =>
    createThemeController(
      (theme) => {
        document.documentElement.dataset.theme = theme
      },
      (query) => window.matchMedia(query)
    )
  )
  // The per-file playback values applied after every load, hydrated from
  // settings.json below and owned by usePlaybackWindow afterwards.
  const perFileValues = usePerFileValues(state.videoAdjustments)
  // The content area subtitles are positioned against (percentage left/top);
  // also the drag-to-reposition gesture's coordinate frame.
  const contentRef = useRef<HTMLDivElement>(null)

  const settingsReady = useSettingsLifecycle({
    dispatch,
    bridge: kizuna.playerSettings,
    settingsPersistenceRef,
    settings: state,
    ...perFileValues,
    setSidebarOpen,
    setPlaylistOpen,
    reportError: mediaSession.banner.reportError
  })

  const activeCue = findActiveCue(state.cues, offsetTimePos(state.timePos, state.subtitleOffsetMs))
  const activeCueKey = activeCue ? cueKey(activeCue) : undefined
  const japaneseSubtitleSelected = isJapaneseSubtitleTrack(state.tracks, state.selectedSubtitleId)

  // Vocabulary and mining lifecycle: tokenization/knowledge caches, the word
  // popup and its Anki mine, the subtitle report, bulk mining, and the
  // sidebar's copy/translate actions — see state/useVocabularyMining.ts.
  const vocabulary = useVocabularyMining({
    bridge: kizuna,
    dispatch,
    player: playerAdapter,
    state,
    pausedRef,
    activeCue,
    activeCueKey,
    japaneseSubtitleSelected,
    sidebarOpen,
    optionsData,
    dictionarySettings: dictionariesState.data,
    targetDeckName: ankiState.data?.settings.deckName
  })
  // Bulk mining's compact surface reserves right-stack width like a panel, so
  // the window-sizing feature below has to know which surface is showing.
  const miningPresentation = vocabulary.mining.presentation

  // Playback and window lifecycle: audio/subtitle menu commands, per-file
  // values, panel sizing, video scale, fullscreen, mini player, and picture
  // adjustments — see state/usePlaybackWindow.ts.
  const playbackWindow = usePlaybackWindow({
    bridge: kizuna,
    dispatch,
    state,
    stateRef,
    perFileValues,
    settingsPersistenceRef,
    settingsReady,
    panels: { sidebarOpen, playlistOpen, setSidebarOpen, setPlaylistOpen },
    miningPresentation,
    initialAudioDevices
  })
  // Attached to the chrome and side-panel elements this component renders;
  // usePlaybackWindow measures them for mpv's video margins and window sizing.
  const {
    topBar: topBarRef,
    bottomBar: bottomBarRef,
    leftSidebarStack: leftSidebarStackRef,
    rightSidebarStack: rightSidebarStackRef
  } = playbackWindow.layoutRefs
  const miniPlayerActive = playbackWindow.miniPlayer.active

  // mpv/window event pushes (time/duration/pause/EOF/fullscreen/media keys)
  // and file-association launch delivery.
  usePlayerEvents({
    dispatch,
    bridge: kizuna,
    playerAdapter,
    stateRef,
    mediaSession: mediaSession.events,
    ...playbackWindow.playerEvents
  })

  // Paints the user's underline-color overrides onto <html> as inline custom
  // properties, which outrank both theme.css blocks — so an override holds
  // across a light/dark switch, and a cleared one falls back to the theme.
  useEffect(() => {
    applyLevelColors(document.documentElement.style, state.levelColors)
  }, [state.levelColors])

  // Applies the appearance setting to the DOM whenever it changes (initial
  // mount applies the default until loadSettings lands, so the window is
  // never themeless). Disposes the OS-change listener on unmount.
  useEffect(() => {
    themeController.setAppearance(state.appearance)
  }, [state.appearance, themeController])
  useEffect(() => {
    return () => {
      themeController.dispose()
    }
  }, [themeController])

  const [modifiers] = useState(createModifierTracker)

  // Drag-to-reposition: started by SubtitleOverlay's onDragStart (mousedown on
  // the subtitle box background, not a word), tracked against #content's rect
  // so the box follows the pointer until mouseup. See state/useSubtitleDrag.ts.
  const { handleSubtitleDragStart } = useSubtitleDrag({
    contentRef,
    dispatch,
    settingsPersistenceRef
  })

  useEffect(() => {
    if (!loopCue) return
    const target = loopSeekTarget(loopCue, state.timePos, state.subtitleOffsetMs)
    if (target !== undefined) void window.kizuna.player.seek(target, true)
  }, [state.timePos, loopCue, state.subtitleOffsetMs])

  const handleToggleLoopLine = (): void => {
    if (loopCue) {
      setLoopCue(null)
      return
    }
    const cue = replayCue(state.cues, state.timePos, state.subtitleOffsetMs)
    if (!cue) return
    // Engaging the per-cue loop clears any armed A–B loop: the two fighting over
    // playback position produces stutter (see media-player-features-plan #3).
    if (state.abLoopState.a !== null) {
      void window.kizuna.player.setAbLoop(null, null)
      dispatch({ type: 'setAbLoop', value: { a: null, b: null } })
    }
    setLoopCue(cue)
  }
  // Advances the A–B loop cycle (no-loop → A → B → clear); engaging it clears any
  // active per-cue loop so the two loops never fight over the playback position.
  const handleCycleAbLoop = (): void => {
    cycleAbLoopAction(window.kizuna.player, dispatch, state.abLoopState, state.timePos, () =>
      setLoopCue(null)
    )
  }
  // Captures the current frame via mpv (main-side). The saved path reuses the
  // media-error banner but auto-dismisses after 1s (see recentFilesController
  // .reportTransient) — a success is worth a glance, not a manual dismiss. A
  // failure keeps the banner's normal sticky, manually-dismissible lifetime so
  // actionable details don't vanish before they can be read.
  const handleScreenshot = async (): Promise<void> => {
    if (!state.filePath) return
    try {
      const path = await window.kizuna.player.screenshot(state.filePath, state.timePos)
      mediaSession.banner.reportTransient(`Screenshot saved: ${path}`)
    } catch (err) {
      mediaSession.banner.reportError(errorMessage(err))
    }
  }
  const keyContext: KeyboardShortcutContext = {
    ...playbackWindow.keyboard,
    player: playerAdapter,
    paused: state.paused,
    fullscreen: state.fullscreen,
    skipSeconds: state.skipSeconds,
    speed: state.speed,
    cues: state.cues,
    chapters: state.chapters,
    timePos: state.timePos,
    subtitleOffsetMs: state.subtitleOffsetMs,
    onToggleLoopLine: handleToggleLoopLine,
    onCycleAbLoop: handleCycleAbLoop,
    onNavigateLine: () => setLoopCue(null),
    onPrevFile: () => mediaSession.navigate('prev'),
    onNextFile: () => mediaSession.navigate('next'),
    onScreenshot: () => void handleScreenshot(),
    keyBindings: state.keyBindings
  }
  // Mirrored into a ref so the window-level keydown listener stays mounted once
  // while still dispatching against the latest render's handlers and state.
  const keyContextRef = useLatestRef<KeyboardShortcutContext | null>(keyContext)
  useKeyboardShortcuts({
    keyContextRef,
    modifiers,
    suspended: optionsOpen || mediaSession.openUrl.open || vocabulary.modalOpen
  })

  // SubtitleSidebar row click: jumps playback to the clicked cue's start,
  // respecting the current subtitle offset the same way the overlay's active
  // cue is resolved (see seekTargetForCue).
  const handleSelectSidebarCue = (cue: Cue): void => {
    window.kizuna.player.seek(seekTargetForCue(cue, state.subtitleOffsetMs), true)
  }

  // Imports a Yomitan dictionary zip (bytes already read by OptionsMenu's
  // native file input), then refreshes the list so the new dictionary
  // appears immediately.
  const handleImportYomitanDict = async (bytes: Uint8Array): Promise<void> => {
    await importYomitanDict(window.kizuna.dict, optionsData, bytes)
  }

  const handleSubscribeImportProgress = (cb: (progress: ImportProgress) => void): (() => void) =>
    window.kizuna.dict.onImportProgress(cb)

  const handleSetYomitanEnabled = async (id: number, enabled: boolean): Promise<void> => {
    await setYomitanEnabled(window.kizuna.dict, optionsData, id, enabled)
  }

  const handleSetYomitanFallbackOnly = async (id: number, fallbackOnly: boolean): Promise<void> => {
    await setYomitanFallbackOnly(window.kizuna.dict, optionsData, id, fallbackOnly)
  }

  const handleReorderYomitanDicts = async (orderedIds: number[]): Promise<void> => {
    await reorderYomitanDicts(window.kizuna.dict, optionsData, orderedIds)
  }

  const handleRemoveYomitanDict = async (id: number): Promise<void> => {
    await removeYomitanDict(window.kizuna.dict, optionsData, id)
  }

  const handleChangeAnkiSettings = async (patch: Partial<AnkiSettings>): Promise<void> => {
    await changeAnkiSettings(window.kizuna.anki, optionsData, patch)
  }

  return (
    <div
      id="app"
      className={appClassName(
        state.fullscreen,
        reveal.top || menuBarOpen,
        reveal.bottom,
        miniPlayerActive
      )}
    >
      <div id="top-controls" ref={topBarRef}>
        <WindowChrome fullscreen={state.fullscreen} filePath={state.filePath} />
        {!miniPlayerActive && (
          <MenuBar
            media={{
              ...mediaSession.mediaMenu,
              playlistOpen,
              onTogglePlaylist: playbackWindow.panels.onTogglePlaylist
            }}
            video={{
              ...mediaSession.qualityMenu,
              ...playbackWindow.videoMenu
            }}
            audio={{
              ...playbackWindow.audioMenu,
              tracks: state.tracks,
              selectedAudioId: state.selectedAudioId
            }}
            subtitle={{
              ...mediaSession.subtitleMenu,
              ...playbackWindow.subtitleMenu,
              tracks: state.tracks,
              selectedSubtitleId: state.selectedSubtitleId,
              externalSubtitleEncoding: state.externalSubtitleEncoding,
              preferredUrlSubtitleLanguage: state.preferredUrlSubtitleLanguage,
              sidebarOpen
            }}
            playback={{
              ...playbackWindow.playbackMenu,
              speed: state.speed,
              onSetSpeed: (speed) => void playerAdapter.setSpeed(speed),
              abLoop: state.abLoopState,
              onCycleAbLoop: handleCycleAbLoop
            }}
            vocabulary={vocabulary.vocabularyMenu}
            onOpenOptions={() => setOptionsOpen(true)}
            onOpenChange={setMenuBarOpen}
          />
        )}
      </div>

      {mediaSession.banner.message && (
        <div id="media-error" role="alert">
          <span>{mediaSession.banner.message}</span>
          <button type="button" aria-label="Dismiss" onClick={mediaSession.banner.dismiss}>
            ×
          </button>
        </div>
      )}

      <div id="player-area">
        {playlistOpen && !state.fullscreen && !miniPlayerActive && (
          <aside id="left-sidebar-stack" ref={leftSidebarStackRef} aria-label="Playlist">
            <PlaylistSidebar
              entries={mediaSession.playlist.state.playlist.entries}
              currentIndex={mediaSession.playlist.state.playlist.currentIndex}
              missing={mediaSession.playlist.state.missing}
              repeat={mediaSession.playlist.state.playlist.repeat}
              shuffle={mediaSession.playlist.state.playlist.shuffle}
              onPlay={mediaSession.playlist.play}
              onRemove={mediaSession.playlist.remove}
              onMove={mediaSession.playlist.move}
              onSetRepeat={mediaSession.playlist.setRepeat}
              onToggleShuffle={mediaSession.playlist.toggleShuffle}
            />
          </aside>
        )}

        <main
          id="content"
          ref={contentRef}
          onContextMenu={(e) => {
            e.preventDefault()
            toggleFromRightClick(state.rightClickTogglePause, state.paused, playerAdapter.setPause)
          }}
        >
          <SubtitleOverlay
            cues={state.cues}
            timePos={offsetTimePos(state.timePos, state.subtitleOffsetMs)}
            tokens={japaneseSubtitleSelected ? state.activeTokens : undefined}
            levels={
              japaneseSubtitleSelected && knowledgeSettings.coloringEnabled
                ? state.knownLevels
                : undefined
            }
            {...vocabulary.subtitleOverlay}
            style={miniPlayerSubtitleStyle(state.subtitleStyle, miniPlayerActive)}
            onDragStart={state.subtitleDragEnabled ? handleSubtitleDragStart : undefined}
            dragEnabled={state.subtitleDragEnabled}
          />
        </main>

        {!state.fullscreen &&
          !miniPlayerActive &&
          (sidebarOpen || miningPresentation === 'sidebar') && (
            <aside id="right-sidebar-stack" ref={rightSidebarStackRef} aria-label="Sidebars">
              {sidebarOpen && (
                <SubtitleSidebar
                  cues={state.cues}
                  activeCueKey={activeCueKey}
                  tokens={japaneseSubtitleSelected ? state.allCueTokens : {}}
                  levels={
                    japaneseSubtitleSelected && knowledgeSettings.coloringEnabled
                      ? state.knownLevels
                      : undefined
                  }
                  {...vocabulary.subtitleSidebar}
                  onSelectCue={handleSelectSidebarCue}
                />
              )}
              {miningPresentation === 'sidebar' && (
                <BulkMiningSidebar {...vocabulary.mining.sidebar} />
              )}
            </aside>
          )}
      </div>

      <BottomBar
        paused={state.paused}
        currentTime={state.timePos}
        duration={state.duration}
        volume={state.volume}
        muted={state.muted}
        skipSeconds={state.skipSeconds}
        speed={state.speed}
        chapters={state.chapters}
        abLoop={state.abLoopState}
        onToggleFullscreen={playbackWindow.fullscreen.toggle}
        miniPlayer={miniPlayerActive}
        onExitMiniPlayer={playbackWindow.miniPlayer.toggle}
        onSetSpeed={(speed) => void playerAdapter.setSpeed(speed)}
        sidebarOpen={sidebarOpen}
        playlistOpen={playlistOpen}
        onToggleSidebar={playbackWindow.panels.onToggleSidebar}
        onTogglePlaylist={playbackWindow.panels.onTogglePlaylist}
        player={playerAdapter}
        containerRef={bottomBarRef}
        mediaPath={state.filePath}
        thumbnailsEnabled={playbackWindow.thumbnailsEnabled}
      />

      <VideoAdjustments
        {...playbackWindow.videoAdjustmentsDialog}
        adjustments={state.videoAdjustments}
      />

      <OpenUrlDialog
        open={mediaSession.openUrl.open}
        loading={mediaSession.openUrl.loading}
        recentUrls={mediaSession.openUrl.recentUrls}
        onSubmit={mediaSession.openUrl.submit}
        onCancelLoad={mediaSession.openUrl.cancelLoad}
        onClose={mediaSession.openUrl.close}
      />

      <OptionsMenu
        open={optionsOpen}
        onClose={() => {
          setOptionsOpen(false)
          void settingsPersistenceRef.current.flush()
        }}
        keybindings={{
          keyBindings: state.keyBindings,
          heldModifiers: modifiers.held,
          onChangeKeyBinding: (action, binding) =>
            dispatch({ type: 'setKeyBinding', action, binding })
        }}
        playback={{
          ...playbackWindow.optionsPlayback,
          skipSeconds: state.skipSeconds,
          rightClickTogglePause: state.rightClickTogglePause,
          autoPlayNext: state.autoPlayNext,
          preferredUrlSubtitleLanguage: state.preferredUrlSubtitleLanguage,
          screenshotFolder: state.screenshotFolder,
          mpvUserConfig: state.mpvUserConfig,
          mpvExtraArgs: state.mpvExtraArgs,
          onChangeSkipSeconds: (value) => dispatch({ type: 'setSkipSeconds', value }),
          onChangeRightClickTogglePause: (value) =>
            dispatch({ type: 'setRightClickTogglePause', value }),
          onChangeAutoPlayNext: (value) => dispatch({ type: 'setAutoPlayNext', value }),
          onChangePreferredUrlSubtitleLanguage: (value) => {
            dispatch({ type: 'setPreferredUrlSubtitleLanguage', value })
            settingsPersistenceRef.current.schedule({ preferredUrlSubtitleLanguage: value })
          },
          onChangeScreenshotFolder: (value) => dispatch({ type: 'setScreenshotFolder', value }),
          onChangeMpvUserConfig: (value) => dispatch({ type: 'setMpvUserConfig', value }),
          onChangeMpvExtraArgs: (value) => dispatch({ type: 'setMpvExtraArgs', value }),
          onOpenMpvConfigDir: () => {
            void window.kizuna.playerSettings.openMpvConfigDir().then(
              (error) => {
                if (error) {
                  mediaSession.banner.reportError(`Could not open the mpv config folder: ${error}`)
                }
              },
              () => mediaSession.banner.reportError('Could not open the mpv config folder.')
            )
          }
        }}
        appearance={{
          appearance: state.appearance,
          levelColors: state.levelColors,
          onChangeAppearance: (value) => dispatch({ type: 'setAppearance', value }),
          onChangeLevelColor: (level, color) => dispatch({ type: 'setLevelColor', level, color })
        }}
        subtitles={{
          subtitleStyle: state.subtitleStyle,
          subtitleDragEnabled: state.subtitleDragEnabled,
          translationEnabled: state.translationEnabled,
          onChangeSubtitleStyle: (value) => dispatch({ type: 'setSubtitleStyle', value }),
          onChangeSubtitleDragEnabled: (value) =>
            dispatch({ type: 'setSubtitleDragEnabled', value }),
          onChangeTranslationEnabled: (value) => {
            dispatch({ type: 'setTranslationEnabled', value })
            settingsPersistenceRef.current.schedule({ translationEnabled: value })
          }
        }}
        dictionaries={{
          mecabDicts: dictionariesData.mecabDicts,
          currentMecabDictId: dictionariesData.currentMecabDictId,
          yomitanDicts: dictionariesData.yomitanDicts,
          loadError: dictionariesState.error,
          popupSettings: state.popupSettings,
          onSelectMecabDict: vocabulary.knowledgeOptions.onSelectMecabDict,
          onImportYomitanDict: handleImportYomitanDict,
          subscribeImportProgress: handleSubscribeImportProgress,
          onSetYomitanEnabled: handleSetYomitanEnabled,
          onSetYomitanFallbackOnly: handleSetYomitanFallbackOnly,
          onReorderYomitanDicts: handleReorderYomitanDicts,
          onRemoveYomitanDict: handleRemoveYomitanDict,
          onChangePopupSettings: (value) => dispatch({ type: 'setPopupSettings', value })
        }}
        anki={{
          ankiSettings: ankiState.data?.settings,
          ankiDeckNames: ankiState.data?.deckNames,
          ankiModelNames: ankiState.data?.modelNames,
          ankiModelFields: ankiState.data?.modelFields,
          ankiPing: () => window.kizuna.anki.ping(),
          onChangeAnkiSettings: handleChangeAnkiSettings,
          loadError: ankiState.error
        }}
        knowledge={{
          wanikaniConfigured: knowledgeSettings.hasWanikaniToken,
          onSaveWanikaniToken: vocabulary.knowledgeOptions.onSaveWanikaniToken,
          ankiDeckNames: ankiState.data?.deckNames ?? [],
          ankiModelFields: ankiState.data?.modelFields ?? [],
          knowledgeSettings,
          onChangeKnowledgeSettings: vocabulary.knowledgeOptions.onChangeKnowledgeSettings,
          loadError: knowledgeState.error,
          syncStatus,
          onSyncNow: vocabulary.knowledgeOptions.onSyncNow
        }}
        setup={{
          setup: setupState.data,
          mecabDicts: dictionariesData.mecabDicts,
          yomitanDicts: dictionariesData.yomitanDicts,
          wanikaniConfigured: knowledgeSettings.hasWanikaniToken,
          syncStatus
        }}
        onCategoryOpen={handleOptionsCategoryOpen}
      />

      <WordPopup
        {...vocabulary.wordPopup}
        maxEntries={state.popupSettings.maxEntries}
        maxMeanings={state.popupSettings.maxMeanings}
      />

      {vocabulary.cardImageDialog.imageBase64 !== undefined && (
        <CardImageCropDialog
          open
          imageBase64={vocabulary.cardImageDialog.imageBase64}
          onSubmit={vocabulary.cardImageDialog.onSubmit}
          onCancel={vocabulary.cardImageDialog.onCancel}
        />
      )}

      <SubtitleReport {...vocabulary.report} />

      {miningPresentation === 'modal' && <BulkMiningModal {...vocabulary.mining.modal} />}
      {vocabulary.mining.completion && (
        <div id="bulk-mining-completion-toast" role="status">
          <span>{vocabulary.mining.completion.text}</span>
          <button
            type="button"
            aria-label="Dismiss mining completion"
            onClick={vocabulary.mining.dismissCompletion}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
