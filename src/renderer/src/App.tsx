import './theme.css'
import './App.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import WindowChrome from './components/WindowChrome'
import MenuBar from './components/MenuBar'
import { LiveBottomBar } from './components/BottomBar'
import OptionsMenu from './components/OptionsMenu'
import AboutDialog from './components/AboutDialog'
import UpdateNotifications from './components/UpdateNotifications'
import SubtitleOverlay from './components/SubtitleOverlay'
import SubtitleSidebar from './components/SubtitleSidebar'
import PlaylistSidebar from './components/PlaylistSidebar'
import SubtitleReport from './components/SubtitleReport'
import JlptCoverageReport from './components/JlptCoverageReport'
import JlptBulkExportModal from './components/JlptBulkExportModal'
import BulkMiningModal from './components/BulkMiningModal'
import VideoAdjustments from './components/VideoAdjustments'
import CardImageCropDialog from './components/CardImageCropDialog'
import BulkMiningSidebar from './components/BulkMiningSidebar'
import WordPopup from './components/WordPopup'
import JimakuSubtitlesDialog from './components/JimakuSubtitlesDialog'
import NoJapaneseSubtitlePrompt from './components/NoJapaneseSubtitlePrompt'
import { initialPlayerState, isJapaneseSubtitleTrack, type PlayerState } from './state/playerState'
import { seekTargetForCue } from './state/cueNavigation'
import { cycleAbLoopAction } from './state/playbackCommands'
import { cueKey } from './state/tokenization'
import { activeLoopCue, loopSeekTarget, replayCue, type LoopSelection } from './state/cueNavigation'
import { buildPlayerAdapter } from './state/playerAdapter'
import { createSubtitleAutoPauseController, useSubtitleAutoPause } from './state/subtitleAutoPause'
import { miniPlayerSubtitleStyle } from './state/miniPlayer'
import { usePlayerEvents } from './state/usePlayerEvents'
import { createTimePosStore, useTimePos } from './state/timePosStore'
import { usePlaybackWindow } from './state/usePlaybackWindow'
import { useAboutDialog } from './state/useAboutDialog'
import { buildOptionsMenuProps } from './state/optionsMenuProps'
import { useSubtitleDrag } from './state/useSubtitleDrag'
import { useFullscreenReveal } from './state/useFullscreenReveal'
import { useFullscreenCursor } from './state/useFullscreenCursor'
import { useLinuxWindowShape } from './state/useLinuxWindowShape'
import { useKeyboardShortcuts, type KeyboardShortcutContext } from './state/useKeyboardShortcuts'
import { useLatestCallback, useLatestRef } from './state/useLatestRef'
import { useMediaSession } from './state/useMediaSession'
import { useJimakuController } from './state/jimakuController'
import { useVocabularyMining } from './state/useVocabularyMining'
import { useJlptCoverageReport } from './state/useJlptCoverageReport'
import { useJlptBulkExport } from './state/useJlptBulkExport'
import { useOptionsController } from './state/useOptionsController'
import { subtitleOffsetForFile } from './state/perFileOffsets'
import { adjustSubtitleFontScale, subtitleFontWheelStep } from './state/subtitleFontWheel'
import { errorMessage } from './util/errorMessage'
import type { KizunaApi } from '../../shared/preloadApi'
import { findActiveCue, offsetTimePos } from '../../shared/cue'
import type { Cue } from '../../shared/cue'
import type { JlptLevel } from '../../shared/jlpt'
import { type AudioDevice } from '../../shared/audioDevice'

export interface AppProps {
  initialState?: PlayerState
  initialAudioDevices?: AudioDevice[]
}

export default function App({
  initialState = initialPlayerState,
  initialAudioDevices = []
}: AppProps): React.JSX.Element {
  // SSR has no window; hooks defer bridge calls to effects and callbacks, so an empty stand-in is safe.
  const kizuna = typeof window === 'undefined' ? ({} as unknown as KizunaApi) : window.kizuna
  useLinuxWindowShape(kizuna.windowControls)
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
  // mpv's per-frame position; kept out of `state` so ticks don't re-render App.
  const timePosStore = useMemo(() => createTimePosStore(), [])
  // A new or closed file starts from 0 until mpv reports the new position.
  useLayoutEffect(() => {
    timePosStore.set(0)
  }, [timePosStore, state.filePath, state.loadGeneration])
  const playerAdapter = useMemo(
    () =>
      buildPlayerAdapter(dispatch, undefined, (seconds, absolute) =>
        subtitleAutoPauseController.notifyUserSeek(seconds, absolute)
      ),
    [dispatch, subtitleAutoPauseController]
  )
  const pausedRef = useLatestRef(state.paused)
  const cursorHidden = useFullscreenCursor(state.fullscreen)
  // Pair the loop with its cue list so replacing the track invalidates it without a reset effect.
  const [loopSelection, setLoopSelection] = useState<LoopSelection | null>(null)
  const loopCue = activeLoopCue(loopSelection, state.cues)
  const setLoopCue = (cue: Cue | null): void =>
    setLoopSelection(cue ? { cues: state.cues, cue } : null)
  // Keep fullscreen controls visible while the pointer enters a dropdown below the top-edge reveal band.
  const [menuBarOpen, setMenuBarOpen] = useState(false)
  const stateRef = useLatestRef(state)
  const getFileSubtitleOffset = (): number =>
    stateRef.current.filePath
      ? subtitleOffsetForFile(
          perFileValues.subtitleOffsetsRef.current,
          perFileValues.folderSubtitleOffsetsRef.current,
          stateRef.current.filePath
        )
      : 0
  const mediaSession = useMediaSession({
    bridge: kizuna,
    dispatch,
    player: playerAdapter,
    state,
    stateRef,
    getFileSubtitleOffset,
    getSubtitleVersionOffset: (contentVersion) =>
      stateRef.current.subtitleOffsetsByVersion[contentVersion] ?? getFileSubtitleOffset()
  })
  const jimaku = useJimakuController({
    jimaku: kizuna.jimaku ?? ({} as KizunaApi['jimaku']),
    getMedia: () => ({
      filePath: stateRef.current.filePath,
      loadGeneration: stateRef.current.loadGeneration
    }),
    subtitles: mediaSession.subtitleActions,
    getSubtitleOffset: (contentVersion) =>
      stateRef.current.subtitleOffsetsByVersion[contentVersion] ?? getFileSubtitleOffset()
  })
  useEffect(() => {
    reportErrorRef.current = mediaSession.banner.reportError
  }, [mediaSession.banner.reportError])
  const optionsOpen = options.open
  const mediaSessionKey = `${state.filePath ?? ''}:${state.loadGeneration}`
  const [dismissedPromptSession, setDismissedPromptSession] = useState<string>()
  const noJapanesePromptDismissed = dismissedPromptSession === mediaSessionKey
  const about = useAboutDialog({
    bridge: kizuna,
    reportError: mediaSession.banner.reportError
  })
  // The content area subtitles are positioned against (percentage left/top);
  // also the drag-to-reposition gesture's coordinate frame.
  const contentRef = useRef<HTMLDivElement>(null)

  // Re-renders App only when playback crosses into a different cue.
  const activeCue = useTimePos(timePosStore, (timePos) =>
    findActiveCue(state.cues, offsetTimePos(timePos, state.subtitleOffsetMs))
  )
  const activeCueKey = activeCue ? cueKey(activeCue) : undefined
  const japaneseSubtitleSelected = isJapaneseSubtitleTrack(state.tracks, state.selectedSubtitleId)
  const subtitleTracks = state.tracks.filter((track) => track.kind === 'subtitle')
  const hasExplicitJapaneseSubtitle = subtitleTracks.some((track) => {
    const language = track.language?.trim().toLowerCase()
    return language === 'ja' || language === 'jpn'
  })
  const hasUnknownSubtitleLanguage = subtitleTracks.some((track) => {
    const language = track.language?.trim().toLowerCase()
    return !language || language === 'und' || language === 'unknown' || language === 'unk'
  })
  const showNoJapanesePrompt =
    state.filePath !== undefined &&
    state.loadGeneration > 0 &&
    !mediaSession.mediaMenu.mediaOpening &&
    !mediaSession.subtitleRestoring &&
    !noJapanesePromptDismissed &&
    !hasExplicitJapaneseSubtitle
  const coloredLevels =
    japaneseSubtitleSelected && options.data.knowledgeSettings.coloringEnabled
      ? state.knownLevels
      : undefined

  const jlptCoverage = useJlptCoverageReport({ bridge: kizuna })

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
  const jlptBulkExport = useJlptBulkExport({
    bridge: kizuna,
    frequencyDictId: state.popupSettings.frequencyDictId,
    sortOrder: state.popupSettings.sortOrder,
    syncNow: vocabulary.syncNow
  })

  const openJlptBulkExport = useLatestCallback(
    (options: { throughLevel?: JlptLevel } = {}): void => {
      jimaku.close()
      jlptCoverage.closeReport()
      vocabulary.report.onClose()
      vocabulary.mining.modal.onClose()
      jlptBulkExport.openExport({
        throughLevel: options.throughLevel ?? jlptCoverage.selectedLevel
      })
    }
  )
  const openJlptCoverage = useLatestCallback((): void => {
    jimaku.close()
    jlptBulkExport.onClose()
    jlptCoverage.openReport()
  })
  const openWordReport = useLatestCallback((): void => {
    jimaku.close()
    jlptBulkExport.onClose()
    vocabulary.vocabularyMenu.onOpenWordReport?.()
  })
  const openBulkMining = useLatestCallback((): void => {
    jimaku.close()
    jlptBulkExport.onClose()
    vocabulary.vocabularyMenu.onOpenBulkMining?.()
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
    timePosStore,
    paused: state.paused,
    japaneseSubtitleSelected,
    prepareCueEligibility: vocabulary.autoPause.prepareCueEligibility,
    reportError: mediaSession.banner.reportError
  })
  // Bulk mining's compact surface reserves right-stack width like a panel, so
  // the window-sizing feature below has to know which surface is showing.
  const miningPresentation = vocabulary.mining.presentation
  const rightSidebarPresentation =
    miningPresentation === 'sidebar' || jlptBulkExport.presentation === 'sidebar'
      ? 'sidebar'
      : miningPresentation

  const playbackWindow = usePlaybackWindow({
    bridge: kizuna,
    dispatch,
    state,
    stateRef,
    perFileValues,
    settingsPersistenceRef,
    settingsReady,
    panels: { sidebarOpen, playlistOpen, setSidebarOpen, setPlaylistOpen },
    miningPresentation: rightSidebarPresentation,
    initialAudioDevices,
    reportError: mediaSession.banner.reportError
  })
  const {
    topBar: topBarRef,
    bottomBar: bottomBarRef,
    leftSidebarStack: leftSidebarStackRef,
    rightSidebarStack: rightSidebarStackRef
  } = playbackWindow.layoutRefs
  const miniPlayerActive = playbackWindow.miniPlayer.active
  const reveal = useFullscreenReveal(state.fullscreen, bottomBarRef)

  usePlayerEvents({
    dispatch,
    timePosStore,
    bridge: kizuna,
    playerAdapter,
    stateRef,
    mediaSession: mediaSession.events,
    ...playbackWindow.playerEvents
  })

  const { handleSubtitleDragStart } = useSubtitleDrag({
    contentRef,
    dispatch,
    settingsPersistenceRef
  })

  useEffect(() => {
    if (!loopCue) return
    const checkLoop = (): void => {
      const target = loopSeekTarget(loopCue, timePosStore.get(), state.subtitleOffsetMs)
      if (target !== undefined) void playerAdapter.seek(target, true)
    }
    checkLoop()
    return timePosStore.subscribe(checkLoop)
  }, [timePosStore, loopCue, state.subtitleOffsetMs, playerAdapter])

  const handleToggleLoopLine = (): void => {
    if (loopCue) {
      setLoopCue(null)
      return
    }
    const cue = replayCue(state.cues, timePosStore.get(), state.subtitleOffsetMs)
    if (!cue) return
    // Clear the competing loop to prevent conflicting seeks and playback stutter.
    if (state.abLoopState.a !== null) {
      void window.kizuna.player.setAbLoop(null, null)
      dispatch({ type: 'set', patch: { abLoopState: { a: null, b: null } } })
    }
    setLoopCue(cue)
  }
  const handleCycleAbLoop = (): void => {
    cycleAbLoopAction(window.kizuna.player, dispatch, state.abLoopState, timePosStore.get(), () =>
      setLoopCue(null)
    )
  }
  // Dismiss screenshot success automatically; keep failures visible until the user acknowledges them.
  const handleScreenshot = async (): Promise<void> => {
    if (!state.filePath) return
    try {
      const path = await window.kizuna.player.screenshot(state.filePath, timePosStore.get())
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
    // Read position at keypress time because playback ticks do not re-render App.
    get timePos() {
      return timePosStore.get()
    },
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
    suspended:
      optionsOpen ||
      about.open ||
      updates.modal !== null ||
      vocabulary.modalOpen ||
      jlptCoverage.open ||
      jlptBulkExport.open
  })

  const closeJimaku = jimaku.close
  useEffect(() => {
    if (
      optionsOpen ||
      about.open ||
      updates.modal !== null ||
      vocabulary.modalOpen ||
      jlptCoverage.open ||
      jlptBulkExport.open
    ) {
      closeJimaku()
    }
  }, [
    about.open,
    closeJimaku,
    jlptBulkExport.open,
    jlptCoverage.open,
    optionsOpen,
    updates.modal,
    vocabulary.modalOpen
  ])

  const handleSelectSidebarCue = (cue: Cue): void => {
    void playerAdapter.seek(seekTargetForCue(cue, state.subtitleOffsetMs), true)
  }

  const closeOptions = options.closeDialog
  const openOptions = useLatestCallback((): void => {
    closeJimaku()
    options.openDialog()
  })
  const openAbout = useLatestCallback((): void => {
    closeJimaku()
    about.openDialog()
  })
  const openJimakuSearch = useLatestCallback((): void => {
    setDismissedPromptSession(mediaSessionKey)
    void jimaku.open()
  })
  const loadLocalSubtitle = useLatestCallback((): void => {
    setDismissedPromptSession(mediaSessionKey)
    closeJimaku()
    mediaSession.subtitleMenu.onLoadSubtitleFile?.()
  })
  const openJimakuSettings = useLatestCallback((): void => {
    setDismissedPromptSession(mediaSessionKey)
    closeJimaku()
    options.openDialog('subtitles')
  })
  const optionsMenu = buildOptionsMenuProps({
    open: optionsOpen,
    requestedCategory: options.requestedCategory,
    settings: state,
    dispatch,
    heldModifiers: modifiers.held,
    data: options.data,
    actions: options.actions,
    onClose: closeOptions,
    onCategoryOpen: options.onCategoryOpen,
    onCategoryRequestHandled: options.clearRequestedCategory,
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
      className={[
        state.fullscreen ? 'fullscreen' : '',
        reveal.top || menuBarOpen ? 'reveal-top' : '',
        reveal.bottom ? 'reveal-bottom' : '',
        miniPlayerActive ? 'mini-player' : '',
        cursorHidden ? 'cursor-hidden' : ''
      ]
        .filter(Boolean)
        .join(' ')}
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
              sidebarOpen,
              hasFile: state.filePath !== undefined,
              onFindJapaneseSubtitles: openJimakuSearch
            }}
            playback={{
              ...playbackWindow.playbackMenu,
              speed: state.speed,
              onSetSpeed: (speed) => void playerAdapter.setSpeed(speed),
              abLoop: state.abLoopState,
              onCycleAbLoop: handleCycleAbLoop,
              subtitleAutoPauseTiming: state.subtitleAutoPauseTiming,
              onChangeSubtitleAutoPauseTiming: (value) =>
                dispatch({ type: 'set', patch: { subtitleAutoPauseTiming: value } }),
              subtitleAutoPauseScope: state.subtitleAutoPauseScope,
              onChangeSubtitleAutoPauseScope: (value) =>
                dispatch({ type: 'set', patch: { subtitleAutoPauseScope: value } })
            }}
            vocabulary={{
              ...vocabulary.vocabularyMenu,
              onOpenWordReport: openWordReport,
              onOpenJlptCoverage: openJlptCoverage,
              onOpenJlptBulkExport: () => openJlptBulkExport(),
              onOpenBulkMining: openBulkMining
            }}
            onOpenOptions={openOptions}
            onOpenAbout={openAbout}
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

      {showNoJapanesePrompt && (
        <NoJapaneseSubtitlePrompt
          conservative={hasUnknownSubtitleLanguage}
          onFind={openJimakuSearch}
          onLoadLocalFile={loadLocalSubtitle}
          onDismiss={() => setDismissedPromptSession(mediaSessionKey)}
        />
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
            if (state.rightClickTogglePause) playerAdapter.setPause(!state.paused)
          }}
        >
          <SubtitleOverlay
            cue={activeCue}
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
          (sidebarOpen || rightSidebarPresentation === 'sidebar') && (
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
              {jlptBulkExport.presentation === 'sidebar' && (
                <BulkMiningSidebar
                  variant="export"
                  phase={jlptBulkExport.phase}
                  onReopen={jlptBulkExport.onReopen}
                  onCancel={jlptBulkExport.onCancel}
                />
              )}
            </aside>
          )}
      </div>

      <LiveBottomBar
        timePosStore={timePosStore}
        paused={state.paused}
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

      <JimakuSubtitlesDialog
        {...jimaku}
        open={jimaku.phase.kind !== 'idle'}
        onClose={jimaku.close}
        onEditIdentity={jimaku.editIdentity}
        onEditEpisode={jimaku.editEpisode}
        onSearch={jimaku.search}
        onChooseTitle={jimaku.chooseTitle}
        onShowMoreFiles={jimaku.showMoreFiles}
        onShowAllFiles={jimaku.showAllFiles}
        onChooseFile={jimaku.chooseFile}
        onChooseMember={jimaku.chooseMember}
        onCancelOperation={jimaku.cancelOperation}
        onTryAnother={jimaku.tryAnother}
        onRevert={jimaku.revert}
        onRefresh={jimaku.refresh}
        onOpenSourcePage={jimaku.openSourcePage}
        onRememberTitleChange={jimaku.rememberTitle}
        onClearRememberedTitle={jimaku.clearRememberedTitle}
        onChangeTitle={jimaku.changeTitle}
        onOpenSettings={openJimakuSettings}
        subtitleOffsetMs={state.subtitleOffsetMs}
        onChangeSubtitleOffset={playbackWindow.subtitleMenu.onChangeSubtitleOffset}
        onLoadLocalFile={loadLocalSubtitle}
      />

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

      <JlptCoverageReport
        open={jlptCoverage.open}
        phase={jlptCoverage.phase}
        data={jlptCoverage.report}
        selectedLevel={jlptCoverage.selectedLevel}
        errorText={jlptCoverage.error ?? undefined}
        onClose={jlptCoverage.closeReport}
        onTargetLevelChange={jlptCoverage.setSelectedLevel}
        onRetry={jlptCoverage.retry}
        onExportUnknowns={() => openJlptBulkExport({ throughLevel: jlptCoverage.selectedLevel })}
      />

      <JlptBulkExportModal {...jlptBulkExport} />

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
