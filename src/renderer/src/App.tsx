import './theme.css'
import './App.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WindowChrome from './components/WindowChrome'
import MenuBar from './components/MenuBar'
import BottomBar from './components/BottomBar'
import OptionsMenu from './components/OptionsMenu'
import AboutDialog from './components/AboutDialog'
import UpdateNotifications from './components/UpdateNotifications'
import SubtitleOverlay from './components/SubtitleOverlay'
import SubtitleSidebar from './components/SubtitleSidebar'
import PlaylistSidebar from './components/PlaylistSidebar'
import SubtitleReport from './components/SubtitleReport'
import BulkMiningModal from './components/BulkMiningModal'
import VideoAdjustments from './components/VideoAdjustments'
import CardImageCropDialog from './components/CardImageCropDialog'
import BulkMiningSidebar from './components/BulkMiningSidebar'
import WordPopup from './components/WordPopup'
import { initialPlayerState, isJapaneseSubtitleTrack, type PlayerState } from './state/playerState'
import { seekTargetForCue } from './state/cueNavigation'
import { cycleAbLoopAction } from './state/playbackCommands'
import { cueKey } from './state/tokenization'
import { activeLoopCue, loopSeekTarget, replayCue, type LoopSelection } from './state/cueNavigation'
import { appClassName, toggleFromRightClick } from './state/appChrome'
import { buildPlayerAdapter } from './state/playerAdapter'
import { createSubtitleAutoPauseController, useSubtitleAutoPause } from './state/subtitleAutoPause'
import { miniPlayerSubtitleStyle } from './state/miniPlayer'
import { usePlayerEvents } from './state/usePlayerEvents'
import { usePlaybackWindow } from './state/usePlaybackWindow'
import { useAboutDialog } from './state/useAboutDialog'
import { buildOptionsMenuProps } from './state/optionsMenuProps'
import { useSubtitleDrag } from './state/useSubtitleDrag'
import { useFullscreenReveal } from './state/useFullscreenReveal'
import { useFullscreenCursor } from './state/useFullscreenCursor'
import { useLinuxWindowShape } from './state/useLinuxWindowShape'
import { useKeyboardShortcuts, type KeyboardShortcutContext } from './state/useKeyboardShortcuts'
import { useLatestRef } from './state/useLatestRef'
import { useMediaSession } from './state/useMediaSession'
import { useVocabularyMining } from './state/useVocabularyMining'
import { useOptionsController } from './state/useOptionsController'
import { adjustSubtitleFontScale, subtitleFontWheelStep } from './state/subtitleFontWheel'
import { errorMessage } from './util/errorMessage'
import type { KizunaApi } from '../../shared/preloadApi'
import { findActiveCue, offsetTimePos } from '../../shared/cue'
import type { Cue } from '../../shared/cue'
import { type AudioDevice } from '../../shared/audioDevice'

// Root React component: the runnable player shell. Wires the reducer + the
// feature hooks that own each workflow (state/useMediaSession.ts for media,
// state/usePlaybackWindow.ts for playback and window,
// state/useVocabularyMining.ts for vocabulary and mining,
// state/useOptionsDialog.ts for settings and optional integrations, and their
// siblings) into the presentational components
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
  useLinuxWindowShape(kizuna.windowControls)
  // Whether the side panels are shown. The shared Options controller restores
  // these values for the player, while standalone Options supplies no-op setters.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const reportErrorRef = useRef<(message: string) => void>(() => undefined)
  const reportError = useCallback((message: string): void => {
    reportErrorRef.current(message)
  }, [])
  const optionsController = useOptionsController({
    bridge: kizuna,
    initialState,
    setSidebarOpen,
    setPlaylistOpen,
    reportError
  })
  const {
    state,
    dispatch,
    settingsReady,
    perFileValues,
    settingsPersistenceRef,
    options,
    gameOcr,
    updates,
    modifiers
  } = optionsController
  const subtitleAutoPauseController = useMemo(() => createSubtitleAutoPauseController(), [])
  const playerAdapter = useMemo(
    () =>
      buildPlayerAdapter(dispatch, undefined, (seconds, absolute) =>
        subtitleAutoPauseController.notifyUserSeek(seconds, absolute)
      ),
    [dispatch, subtitleAutoPauseController]
  )
  const pausedRef = useLatestRef(state.paused)
  const reveal = useFullscreenReveal(state.fullscreen)
  const cursorHidden = useFullscreenCursor(state.fullscreen)
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
  useEffect(() => {
    reportErrorRef.current = mediaSession.banner.reportError
  }, [mediaSession.banner.reportError])
  const optionsOpen = options.open
  const about = useAboutDialog({
    bridge: kizuna,
    reportError: mediaSession.banner.reportError
  })
  // The content area subtitles are positioned against (percentage left/top);
  // also the drag-to-reposition gesture's coordinate frame.
  const contentRef = useRef<HTMLDivElement>(null)

  const activeCue = findActiveCue(state.cues, offsetTimePos(state.timePos, state.subtitleOffsetMs))
  const activeCueKey = activeCue ? cueKey(activeCue) : undefined
  const japaneseSubtitleSelected = isJapaneseSubtitleTrack(state.tracks, state.selectedSubtitleId)
  // Known-word underlines are painted only for a Japanese subtitle track, and
  // only while the Known-words option has coloring switched on.
  const coloredLevels =
    japaneseSubtitleSelected && options.data.knowledgeSettings.coloringEnabled
      ? state.knownLevels
      : undefined

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
    optionsData: options.controller,
    dictionarySettings: options.data.dictionaries,
    targetDeckName: options.data.anki?.settings.deckName
  })
  useSubtitleAutoPause({
    controller: subtitleAutoPauseController,
    player: playerAdapter,
    timing: state.subtitleAutoPauseTiming,
    scope: state.subtitleAutoPauseScope,
    cues: state.cues,
    selectedSubtitleId: state.selectedSubtitleId,
    filePath: state.filePath,
    loadGeneration: state.loadGeneration,
    subtitleOffsetMs: state.subtitleOffsetMs,
    timePos: state.timePos,
    paused: state.paused,
    japaneseSubtitleSelected,
    prepareCueEligibility: vocabulary.autoPause.prepareCueEligibility,
    reportError: mediaSession.banner.reportError
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
    initialAudioDevices,
    reportError: mediaSession.banner.reportError
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
    if (target !== undefined) void playerAdapter.seek(target, true)
  }, [state.timePos, loopCue, state.subtitleOffsetMs, playerAdapter])

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
  const handleAdjustSubtitleFontScale = (step: -1 | 1): void => {
    dispatch({
      type: 'setSubtitleStyle',
      value: {
        fontScale: adjustSubtitleFontScale(state.subtitleStyle.fontScale, step)
      }
    })
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
    onAdjustSubtitleFontScale: handleAdjustSubtitleFontScale,
    keyBindings: state.keyBindings
  }
  // Mirrored into a ref so the window-level keydown listener stays mounted once
  // while still dispatching against the latest render's handlers and state.
  const keyContextRef = useLatestRef<KeyboardShortcutContext | null>(keyContext)
  useKeyboardShortcuts({
    keyContextRef,
    modifiers,
    suspended: optionsOpen || about.open || updates.modal !== null || vocabulary.modalOpen
  })

  // SubtitleSidebar row click: jumps playback to the clicked cue's start,
  // respecting the current subtitle offset the same way the overlay's active
  // cue is resolved (see seekTargetForCue).
  const handleSelectSidebarCue = (cue: Cue): void => {
    void playerAdapter.seek(seekTargetForCue(cue, state.subtitleOffsetMs), true)
  }

  const closeOptions = options.closeDialog

  // The Options dialog's props, assembled from their owners: reducer-backed
  // settings, the dialog's own integration data/actions, the playback feature's
  // mpv-output rows, and the vocabulary feature's cache-invalidating rows.
  const optionsMenu = buildOptionsMenuProps({
    open: optionsOpen,
    settings: state,
    dispatch,
    heldModifiers: modifiers.held,
    data: options.data,
    actions: options.actions,
    onClose: closeOptions,
    onCategoryOpen: options.onCategoryOpen,
    playback: playbackWindow.optionsPlayback,
    knowledge: vocabulary.knowledgeOptions,
    updates: {
      settings: updates.settings,
      onChangeCheckAutomatically: updates.setCheckAutomatically
    },
    supportsGameOcr: gameOcr.supported,
    gameOcr: gameOcr.options
  })

  return (
    <div
      id="app"
      className={appClassName(
        state.fullscreen,
        reveal.top || menuBarOpen,
        reveal.bottom,
        miniPlayerActive,
        cursorHidden
      )}
    >
      <div id="top-controls" ref={topBarRef}>
        <WindowChrome fullscreen={state.fullscreen} filePath={state.filePath} />
        {!miniPlayerActive && (
          <MenuBar
            media={{
              ...mediaSession.mediaMenu,
              playlistOpen,
              onTogglePlaylist: playbackWindow.panels.onTogglePlaylist,
              onExit: () => window.kizuna.appShell.quit()
            }}
            video={{
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
              sidebarOpen
            }}
            playback={{
              ...playbackWindow.playbackMenu,
              speed: state.speed,
              onSetSpeed: (speed) => void playerAdapter.setSpeed(speed),
              abLoop: state.abLoopState,
              onCycleAbLoop: handleCycleAbLoop,
              subtitleAutoPauseTiming: state.subtitleAutoPauseTiming,
              onChangeSubtitleAutoPauseTiming: (value) =>
                dispatch({ type: 'setSubtitleAutoPauseTiming', value }),
              subtitleAutoPauseScope: state.subtitleAutoPauseScope,
              onChangeSubtitleAutoPauseScope: (value) =>
                dispatch({ type: 'setSubtitleAutoPauseScope', value })
            }}
            vocabulary={vocabulary.vocabularyMenu}
            onOpenOptions={options.openDialog}
            onOpenAbout={about.openDialog}
            onOpenChange={setMenuBarOpen}
            gameOcr={gameOcr.menu}
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
          onWheel={(event) => {
            const step = subtitleFontWheelStep(event, state.keyBindings, modifiers.held)
            if (step === null) return
            event.preventDefault()
            handleAdjustSubtitleFontScale(step)
          }}
          onDoubleClick={playbackWindow.fullscreen.toggle}
          onContextMenu={(e) => {
            e.preventDefault()
            toggleFromRightClick(state.rightClickTogglePause, state.paused, playerAdapter.setPause)
          }}
        >
          <SubtitleOverlay
            cues={state.cues}
            timePos={offsetTimePos(state.timePos, state.subtitleOffsetMs)}
            tokens={japaneseSubtitleSelected ? state.activeTokens : undefined}
            levels={coloredLevels}
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
                  levels={coloredLevels}
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

      <OptionsMenu {...optionsMenu} />

      <AboutDialog
        open={about.open}
        info={about.info}
        noticeMessage={about.noticeMessage}
        onClose={about.closeDialog}
        onOpenLink={about.openLink}
        onOpenNotices={about.openNotices}
        updateState={updates.snapshot}
        onCheckForUpdates={updates.checkManually}
        onDownloadUpdate={updates.download}
        onInstallUpdate={updates.install}
        onRetryUpdate={updates.retry}
      />

      <UpdateNotifications updates={updates} suppressed={about.open} />

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
