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
import OptionsMenu, { type OptionsCategory } from './components/OptionsMenu'
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
import { type MineMediaSource } from './state/ankiMining'
import { seekTargetForCue } from './state/cueNavigation'
import { performFileNavigation } from './state/keyActions'
import { type OpenMediaResult, type SubtitleRequestToken, shouldProbe } from './state/mediaSession'
import { nextAudioDelays, nextSubtitleOffsets } from './state/perFileOffsets'
import {
  type FrameStepGuard,
  applyVideoAdjustments,
  cycleAbLoopAction,
  frameStepAction
} from './state/playbackCommands'
import { cueKey } from './state/tokenization'
import {
  loadExternalSubtitle,
  onlineSubtitleTrack,
  selectAudio,
  selectSubtitle
} from './state/trackSelection'
import { wordPopupPosition } from './state/wordLookup'
import { activeLoopCue, loopSeekTarget, replayCue, type LoopSelection } from './state/cueNavigation'
import {
  appClassName,
  toggleFromRightClick,
  toggleSidebar,
  applyOffsetToFolder,
  shouldOpenWordPopup,
  shouldClosePopupOnPointerDown,
  handleDroppedFiles,
  copySidebarCue,
  videoScaleWindowSize,
  videoContentBaseline,
  sidebarPreservingWindowSize,
  type VideoContentBaseline,
  appendPathsToPlaylist,
  appendPlaylistFile,
  loadSubtitleFromPicker,
  buildPlayerAdapter,
  DEFAULT_DICTIONARIES_DATA,
  DEFAULT_KNOWLEDGE_SETTINGS,
  DEFAULT_SYNC_STATUS,
  optionsDataBridge,
  type PlaylistAppendDeps
} from './state/appShell'
import {
  INACTIVE_MINI_PLAYER,
  miniPlayerSubtitleStyle,
  type MiniPlayerState
} from './state/miniPlayer'
import { createPopupController } from './state/popupController'
import { createSubtitleReportController } from './state/subtitleReportController'
import { createBulkMiningController } from './state/bulkMiningController'
import type { VocabularySpan } from './state/vocabularySpans'
import { createWholeTrackVocabularyCoordinator } from './state/wholeTrackVocabulary'
import {
  createBulkMiningCompletionTracker,
  type BulkMiningCompletionEvent
} from './state/bulkMiningCompletion'
import {
  hideBulkMiningToSidebar,
  reopenBulkMiningModal,
  type BulkMiningPresentation
} from './state/bulkMiningPresentation'
import { createRecentFilesController } from './state/recentFilesController'
import { createUrlSubtitleController } from './state/urlSubtitleController'
import { createSettingsPersistence } from './state/settingsPersistence'
import { useSettingsLifecycle } from './state/useSettingsLifecycle'
import { usePerFileRestore } from './state/usePerFileRestore'
import { usePlayerEvents } from './state/usePlayerEvents'
import { useVocabularyPipeline } from './state/useVocabularyPipeline'
import { useMiniPlayer } from './state/useMiniPlayer'
import { useAudioDevices } from './state/audioDevices'
import { createThemeController } from './state/themeController'
import { createOptionsDataController } from './state/optionsData'
import {
  loadCategoryDomains,
  selectMecabDict,
  importYomitanDict,
  setYomitanEnabled,
  setYomitanFallbackOnly,
  reorderYomitanDicts,
  removeYomitanDict,
  saveWanikaniToken,
  changeAnkiSettings,
  changeKnowledgeSettings,
  shouldResyncAnkiForKnowledgePatch,
  syncKnowledgeAndRefresh
} from './state/integrationActions'
import { refreshKnownLevels } from './state/knowledgeActions'
import { createHoverDebouncer, createModifierTracker, type HoverDebouncer } from './util/uiHelpers'
import { useSubtitleDrag } from './state/useSubtitleDrag'
import { useFullscreenReveal } from './state/useFullscreenReveal'
import { useVideoMargins } from './state/useVideoMargins'
import { useKeyboardShortcuts, type KeyboardShortcutContext } from './state/useKeyboardShortcuts'
import { useLatestCallback, useLatestRef } from './state/useLatestRef'
import { applyLevelColors } from './util/levelColors'
import { errorMessage } from './util/errorMessage'
import { isRemoteUrl } from '../../shared/mediaFileTypes'
import { isExtractorBackedUrl, type YtdlpQuality } from '../../shared/ytdlpQuality'
import type { KizunaApi } from '../../shared/preloadApi'
import { createPlaylistController, type PlaylistLoadDeps } from './state/playlistController'
import { createYtdlpQualityReloadController } from './state/ytdlpQualityReload'
import { findActiveCue, offsetTimePos } from '../../shared/cue'
import type { Cue } from '../../shared/cue'
import type { Token } from '../../shared/token'
import { URL_SUBTITLE_TRACK_ID, type VideoDimensions } from '../../shared/track'
import type { VideoAdjustments as VideoAdjustmentsValue } from '../../shared/playerSettings'
import { effectiveAudioDevice, type AudioDevice } from '../../shared/audioDevice'
import type { SubtitleEncoding } from '../../shared/subtitleEncoding'
import type {
  KnowledgeLevel,
  KnowledgeSource,
  PublicKnowledgeSettings,
  SyncStatus
} from '../../shared/knowledge'
import type { LookupResult, ImportProgress } from '../../shared/dictionary'
import type { AnkiSettings } from '../../shared/anki'

// Root React component: the runnable player shell. Wires the reducer +
// orchestration modules (state/mediaOpen.ts and siblings) into the presentational
// components (WindowChrome/MenuBar/BottomBar/SubtitleOverlay).
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
  const [ytdlpQuality, setYtdlpQuality] = useState<{ path: string; value: YtdlpQuality } | null>(
    null
  )
  const [qualityReloading, setQualityReloading] = useState(false)
  const reveal = useFullscreenReveal(state.fullscreen)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [videoAdjustmentsOpen, setVideoAdjustmentsOpen] = useState(false)
  const [openUrlDialogOpen, setOpenUrlDialogOpen] = useState(false)
  // A captured frame awaiting the user's crop decision, together with the
  // dictionary entry whose mine triggered it (see handleAddToAnki).
  const [cardImageRequest, setCardImageRequest] = useState<{
    imageBase64: string
    result: LookupResult
  } | null>(null)
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
  // Shared across openAndLoad's auto-selected default and manual subtitle
  // picks so a slower in-flight ffmpeg extraction can't clobber a newer one.
  const subtitleToken = useRef<SubtitleRequestToken>({ current: 0 })
  // Per-track extracted-cue cache, keyed by track id. openAndLoad clears it
  // on every new file; re-picking a track already extracted for the current
  // file is then a synchronous dispatch instead of another ffmpeg run.
  // openAndLoad also warms this cache in the background for every non-default
  // subtitle track, so a later manual switch is usually already cached.
  const subtitleCueCache = useRef(new Map<number, Cue[]>())
  // Guards openAndLoad's background cache warm-up: bumped once per file open
  // so a still-running extraction from a previously opened file can't write
  // stale cues into the cache after a newer file has cleared it.
  const fileLoadToken = useRef<SubtitleRequestToken>({ current: 0 })
  // Drops frame-step presses while a previous step's IPC invoke is still in
  // flight, so holding the key down can't flood mpv's command queue.
  const frameStepGuard = useRef<FrameStepGuard>({ inFlight: false })
  const stateRef = useLatestRef(state)
  // Per-cue tokenization cache + a request-token guard against stale MeCab
  // resolutions, mirroring subtitleToken above. Held in refs so they persist
  // across renders without themselves triggering one.
  const tokenCache = useRef(new Map<string, Token[]>())
  const tokenizeToken = useRef<SubtitleRequestToken>({ current: 0 })
  // Lemma -> resolved knowledge level, warmed across the whole episode (never
  // cleared per cue, unlike tokenCache) plus a request-token guard against a
  // stale resolveKnownLevels resolution, mirroring tokenizeToken above.
  const knownLevelsCache = useRef(new Map<string, KnowledgeLevel>())
  const knownLevelsToken = useRef<SubtitleRequestToken>({ current: 0 })
  // Whether the all-subtitles side panel (SubtitleSidebar) is shown. Restored
  // from settings.json on mount and persisted by handleToggleSidebar.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Whether the playlist (play-queue) side panel is shown. Restored from
  // settings.json on mount and persisted by handleTogglePlaylist.
  const [playlistOpen, setPlaylistOpen] = useState(false)
  // Request-token guards for tokenizeAllCues' batch tokenize + level
  // resolution, separate from tokenizeActiveCue's own tokens/knownLevelsToken
  // above so opening/closing the sidebar never invalidates an in-flight
  // active-cue tokenization (or vice versa) despite sharing tokenCache/
  // knownLevelsCache as the underlying caches.
  const allCuesToken = useRef<SubtitleRequestToken>({ current: 0 })
  const allCuesLevelsToken = useRef<SubtitleRequestToken>({ current: 0 })
  const wholeTrackVocabularyRef = useRef(createWholeTrackVocabularyCoordinator())
  const vocabularySpanEpoch = useRef(0)
  const [vocabularySpansByCue, setVocabularySpansByCue] = useState<
    Record<string, VocabularySpan[]>
  >({})
  // The shared right-side stack is measured once to keep mpv out from under
  // either (or both) sidebar surfaces.
  const rightSidebarStackRef = useRef<HTMLElement>(null)
  // The left-side stack holds the playlist; measured so mpv stays out from
  // under it too, exactly like the right stack.
  const leftSidebarStackRef = useRef<HTMLElement>(null)
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
  // Popup request/history/Anki-mining orchestration — see state/popupController.ts.
  const [popupController] = useState(createPopupController)
  const popupState = useSyncExternalStore(
    popupController.subscribe,
    () => popupController.getState(),
    () => popupController.getState()
  )
  const {
    popup: wordPopup,
    history: popupHistory,
    ankiStatus,
    ankiError,
    ankiExisting
  } = popupState
  // F1 subtitle report orchestration — see state/subtitleReportController.ts.
  const [reportController] = useState(createSubtitleReportController)
  const reportPhase = useSyncExternalStore(
    reportController.subscribe,
    () => reportController.getState(),
    () => reportController.getState()
  )
  const [reportOpen, setReportOpen] = useState(false)
  const [bulkMiningController] = useState(createBulkMiningController)
  const bulkMiningPhase = useSyncExternalStore(
    bulkMiningController.subscribe,
    () => bulkMiningController.getState(),
    () => bulkMiningController.getState()
  )
  const [miningPresentation, setMiningPresentation] = useState<BulkMiningPresentation>('closed')
  const miningSessionToken = useRef(0)
  const miningCompletionTrackerRef = useRef(createBulkMiningCompletionTracker())
  const [miningCompletion, setMiningCompletion] = useState<BulkMiningCompletionEvent | null>(null)
  // Media menu's recent-files list, open/loading flag, and dismissible media
  // error surface — see state/recentFilesController.ts.
  const [recentFiles] = useState(createRecentFilesController)
  const recentFilesState = useSyncExternalStore(
    recentFiles.subscribe,
    () => recentFiles.getState(),
    () => recentFiles.getState()
  )
  // Online (yt-dlp URL) subtitle catalog for the Subtitle menu. Session-only:
  // acquired cues feed the same DOM cue lifecycle as
  // external/local subtitles (onlineSubtitleLoaded/onlineSubtitleCleared), but
  // nothing here is persisted to MediaHistory. The bridge reads window at call
  // time; `cancel` is optional-chained so a preload without the surface (some
  // test fakes) degrades to a hidden section instead of throwing.
  const [urlSubtitleController] = useState(() =>
    createUrlSubtitleController({
      bridge: {
        enumerate: (url) => window.kizuna.urlSubtitles.enumerate(url),
        acquire: (descriptor) => window.kizuna.urlSubtitles.acquire(descriptor),
        cancel: () => window.kizuna.urlSubtitles?.cancel?.()
      },
      sink: {
        injectCues: (asset) =>
          dispatch({
            type: 'onlineSubtitleLoaded',
            track: onlineSubtitleTrack(asset.cues),
            cues: asset.cues
          }),
        clear: () => dispatch({ type: 'onlineSubtitleCleared' })
      },
      onWarning: (message) => recentFiles.reportError(message),
      preferredLanguage: () => stateRef.current.preferredUrlSubtitleLanguage
    })
  )
  const urlSubtitleState = useSyncExternalStore(
    urlSubtitleController.subscribe,
    () => urlSubtitleController.getState(),
    () => urlSubtitleController.getState()
  )
  // Renderer-owned play queue (Feature 1). Loading routes through the same
  // recent-files open pipeline so subtitles/tracks/history stay consistent.
  // Declared ahead of openSession because its onPlaylistPicked reads this
  // controller.
  const [playlistController] = useState(createPlaylistController)
  const playlistState = useSyncExternalStore(
    playlistController.subscribe,
    () => playlistController.getState(),
    () => playlistController.getState()
  )
  // The one OpenSession construction point for App's direct opens (neighbor
  // navigation, playlist, URL dialog, drop, launch delivery) — see
  // state/mediaSession.ts's OpenSession. Rebuilt on every call rather than
  // memoized, so a handler closed over on an earlier render still reads the
  // token refs' current values instead of a stale snapshot.
  const openSession = () => ({
    bridge: window.kizuna,
    dispatch,
    subtitleToken: subtitleToken.current,
    cueCache: subtitleCueCache.current,
    fileToken: fileLoadToken.current,
    onPlaylistPicked: (paths: string[]) => {
      playlistController.clear()
      playlistController.addPaths(paths)
    }
  })
  // Stable identity (see useLatestCallback) so the mount-once listeners and the
  // memoized navigation callbacks below can depend on it without re-subscribing
  // every render; each call still builds a fresh OpenSession.
  const openPath = useLatestCallback((path: string): Promise<OpenMediaResult> =>
    recentFiles.openPath(openSession(), path)
  )
  const [ytdlpQualityController] = useState(() =>
    createYtdlpQualityReloadController({
      setYtdlpQuality: (quality) => window.kizuna.player.setYtdlpQuality(quality),
      openUrl: (url) => openPath(url),
      seek: (seconds, absolute) => window.kizuna.player.seek(seconds, absolute),
      setPause: (paused) => window.kizuna.player.setPause(paused),
      cancelLoad: () => window.kizuna.player.cancelLoad()
    })
  )
  const qualityVisible = isExtractorBackedUrl(state.filePath)
  const displayedYtdlpQuality =
    ytdlpQuality && ytdlpQuality.path === state.filePath ? ytdlpQuality.value : ('best' as const)
  const handleSetYtdlpQuality = useLatestCallback(async (quality: YtdlpQuality): Promise<void> => {
    const current = stateRef.current
    if (!isExtractorBackedUrl(current.filePath)) return
    setQualityReloading(true)
    try {
      const result = await ytdlpQualityController.reload({
        quality,
        url: current.filePath,
        timePos: current.timePos,
        paused: current.paused
      })
      if (result === 'reloaded' && stateRef.current.filePath === current.filePath) {
        setYtdlpQuality({ path: current.filePath, value: quality })
      }
    } catch (error) {
      recentFiles.reportError(errorMessage(error))
    } finally {
      setQualityReloading(false)
    }
  })
  // A subsequent direct open or unmount makes any pending quality reload stale
  // and tells mpv to abort its extractor request.
  useEffect(
    () => () => {
      void ytdlpQualityController.cancel()
    },
    [state.filePath, ytdlpQualityController]
  )
  // Begins the online-subtitle lifecycle for each loaded media. Keyed on
  // loadGeneration too, so reopening the same URL (e.g. a quality reload)
  // re-enumerates. A non-extractor URL or local file hides the section; the
  // controller's generation bump discards any in-flight enumerate/acquire from
  // the previous media.
  useEffect(() => {
    urlSubtitleController.load(state.filePath)
  }, [state.filePath, state.loadGeneration, urlSubtitleController])
  // App cleanup invalidates any pending online-subtitle work and aborts the bridge.
  useEffect(() => () => urlSubtitleController.dispose(), [urlSubtitleController])
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
  // Measured to keep the mpv video frame out from under these bars (see the
  // useVideoMargins hook below).
  const topBarRef = useRef<HTMLDivElement>(null)
  const bottomBarRef = useRef<HTMLDivElement>(null)
  // Per-file subtitle offsets (ms), persisted via playerSettings.setSettings.
  // Held in a ref (not state) since it's read/written outside the render
  // path and only ever needs the current file's entry reflected in state
  // (state.subtitleOffsetMs), not the whole map.
  const subtitleOffsetsRef = useRef<Record<string, number>>({})
  // Per-folder subtitle offsets (ms), the fallback for any file in the folder
  // with no per-file entry — written by the Subtitle menu's "Apply to folder".
  const folderSubtitleOffsetsRef = useRef<Record<string, number>>({})
  // Per-file audio delays (ms), persisted via playerSettings.setSettings —
  // held in a ref for the same reason as subtitleOffsetsRef.
  const audioDelaysRef = useRef<Record<string, number>>({})
  // Latest app-wide picture adjustments, mirrored into a ref so the per-load
  // re-apply effect can read them without listing state.videoAdjustments in its
  // deps (which would re-fire it on every slider drag).
  const videoAdjustmentsRef = useRef<VideoAdjustmentsValue>(state.videoAdjustments)
  // Native pixel resolution of the current file's video stream, used by the
  // Video menu's size presets; undefined until fetched (or if there's no
  // video stream).
  const [videoDimensions, setVideoDimensions] = useState<VideoDimensions | undefined>(undefined)
  // The last size preset the user explicitly picked from Video ▸ Size, kept so
  // opening/closing a side panel can re-apply it (see applyVideoScale).
  // Undefined until a preset is picked; the default size is preserved through
  // videoContentBaselineRef instead.
  const [requestedVideoScale, setRequestedVideoScale] = useState<number | undefined>(undefined)
  // The video rectangle a side-panel toggle has to preserve while no preset is
  // in play — the window content box minus the panels open when it was
  // measured. Re-measured whenever the window itself resizes (see below), never
  // during a panel transition, so it always describes the picture the user is
  // currently looking at rather than a fabricated scale.
  const videoContentBaselineRef = useRef<VideoContentBaseline | undefined>(undefined)
  // mpv output selection (list refresh, explicit picks, per-load re-apply).
  const audioDeviceController = useAudioDevices({
    player: kizuna.player,
    dispatch,
    storedDeviceRef: stateRef,
    initialDevices: initialAudioDevices
  })
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  // Compact mini-player (picture-in-picture) mode. `miniPlayer.active` gates the
  // reduced chrome; the ref mirror lets the toggle-fullscreen wrapper read the
  // current mode without re-subscribing. See `state/miniPlayer.ts`.
  const [miniPlayer, setMiniPlayer] = useState<MiniPlayerState>(INACTIVE_MINI_PLAYER)
  const miniPlayerRef = useLatestRef(miniPlayer)
  const miniPlayerActive = miniPlayer.active
  const { applyMiniPlayerEffect, handleToggleMiniPlayer, toggleFullscreenFromKey } = useMiniPlayer({
    setMiniPlayer,
    miniPlayerRef,
    alwaysOnTop,
    setAlwaysOnTop,
    windowControls: kizuna.windowControls,
    stateRef,
    topBarRef,
    bottomBarRef
  })
  useVideoMargins({
    topBarRef,
    bottomBarRef,
    rightSidebarStackRef,
    leftSidebarStackRef,
    fullscreen: state.fullscreen,
    sidebarOpen,
    playlistOpen,
    miningPresentation,
    miniPlayerActive,
    player: kizuna.player
  })
  // The content area subtitles are positioned against (percentage left/top);
  // also the drag-to-reposition gesture's coordinate frame.
  const contentRef = useRef<HTMLDivElement>(null)

  const handleOpenNeighbor = useCallback(
    async (direction: 'prev' | 'next'): Promise<void> => {
      const current = stateRef.current
      if (!current.filePath || recentFiles.getState().mediaOpening) return
      const neighbors = await window.kizuna.media.folderNeighbors(current.filePath)
      const target = direction === 'next' ? neighbors.next : neighbors.prev
      if (!target) return
      void openPath(target)
    },
    [openPath, recentFiles, stateRef]
  )

  // The load seam the playlist controller drives: the same open pipeline the
  // Media menu / drops use, so a queued file gets subtitles, tracks and history.
  const playlistLoadDeps = useLatestCallback((): PlaylistLoadDeps => ({
    load: (path) => openPath(path),
    play: () => playerAdapter.setPause(false)
  }))

  // mpv/window event pushes (time/duration/pause/EOF/fullscreen/media keys)
  // and file-association launch delivery.
  usePlayerEvents({
    dispatch,
    bridge: kizuna,
    playerAdapter,
    handleOpenNeighbor,
    stateRef,
    recentFiles,
    playlistController,
    playlistLoadDeps,
    miniPlayerRef,
    setMiniPlayer,
    setAlwaysOnTop,
    applyMiniPlayerEffect,
    openPath
  })

  // Fetches the recent-files list once on mount. A failure surfaces as a
  // dismissible warning and leaves the list empty; it must not block
  // playback (see recentFilesController.init).
  useEffect(() => {
    void recentFiles.init(window.kizuna)
  }, [recentFiles])

  // Cancels a pending transient-banner auto-dismiss timer (e.g. a screenshot
  // "saved" message) so it cannot fire and touch state after unmount.
  useEffect(() => () => recentFiles.dispose(), [recentFiles])

  const settingsReady = useSettingsLifecycle({
    dispatch,
    bridge: kizuna.playerSettings,
    settingsPersistenceRef,
    settings: state,
    subtitleOffsetsRef,
    folderSubtitleOffsetsRef,
    audioDelaysRef,
    videoAdjustmentsRef,
    setSidebarOpen,
    setPlaylistOpen,
    reportError: recentFiles.reportError
  })

  // Applies the current file's persisted subtitle offset (its own entry, else
  // its folder's — see subtitleOffsetForFile) and fetches its video stream's
  // native resolution (for the Video menu's size presets) whenever a new file
  // loads. Both offset refs are populated by the settings-load effect above (or
  // already hold this file's entry if it was set earlier this session).
  usePerFileRestore({
    dispatch,
    bridge: kizuna,
    filePath: state.filePath,
    loadGeneration: state.loadGeneration,
    settingsReady,
    playbackSettingsRef: stateRef,
    subtitleOffsetsRef,
    folderSubtitleOffsetsRef,
    audioDelaysRef,
    videoAdjustmentsRef,
    reapplyAudioDevice: audioDeviceController.reapplyAfterLoad,
    setVideoDimensions
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

  const toggleFullscreen = (): void => window.kizuna.windowControls.toggleFullscreen()

  // Updates the current subtitle offset immediately and persists it keyed by
  // the current file path, so re-opening the file later re-applies it.
  const handleSubtitleOffsetChange = (valueMs: number): void => {
    dispatch({ type: 'setSubtitleOffset', value: valueMs })
    if (!state.filePath) return
    subtitleOffsetsRef.current = nextSubtitleOffsets(
      subtitleOffsetsRef.current,
      state.filePath,
      valueMs
    )
    settingsPersistenceRef.current.schedule({ subtitleOffsets: subtitleOffsetsRef.current })
  }

  // Applies the audio delay immediately and persists it keyed by the current
  // file path, mirroring handleSubtitleOffsetChange.
  const handleAudioDelayChange = (valueMs: number): void => {
    dispatch({ type: 'setAudioDelay', value: valueMs })
    void window.kizuna.player.setAudioDelay(valueMs)
    if (!state.filePath) return
    audioDelaysRef.current = nextAudioDelays(audioDelaysRef.current, state.filePath, valueMs)
    settingsPersistenceRef.current.schedule({ audioDelays: audioDelaysRef.current })
  }

  // Audio menu > track list. Ignores ids with no matching audio track, and
  // does nothing without a loaded file (there is no stream to switch).
  const handleSelectAudio = (id: number): void => {
    const track = state.tracks.find((t) => t.kind === 'audio' && t.id === id)
    if (state.filePath && track) selectAudio(window.kizuna, dispatch, state.filePath, track)
  }

  const handleToggleLoudnessNorm = (): void => {
    const next = !state.loudnessNormalization
    dispatch({ type: 'setLoudnessNormalization', value: next })
    void window.kizuna.player.setLoudnessNorm(next)
  }

  // Subtitle menu > track list; `null` turns subtitles off. An id with no
  // matching subtitle track is ignored, but `null` is a real choice — hence
  // the `!== undefined` check rather than a truthiness test.
  const handleSelectSubtitle = (id: number | null): void => {
    if (!state.filePath) return
    // The plain "Off" row also turns an active online subtitle off, routing
    // through the controller so its cues are cleared and pending acquisition
    // invalidated — session-only, so nothing is persisted.
    if (id === null && state.selectedSubtitleId === URL_SUBTITLE_TRACK_ID) {
      urlSubtitleController.selectOff()
      return
    }
    const track =
      id === null ? null : state.tracks.find((t) => t.kind === 'subtitle' && t.id === id)
    if (track === undefined) return
    selectSubtitle(
      window.kizuna,
      dispatch,
      state.filePath,
      track,
      subtitleToken.current,
      subtitleCueCache.current,
      state.externalSubtitlePath,
      state.externalSubtitleEncoding
    )
  }

  // Subtitle menu > Encoding: re-decodes the loaded external subtitle file
  // with the chosen codepage. Only meaningful while an external subtitle is
  // loaded; embedded tracks carry their own encoding.
  const handleChangeExternalSubtitleEncoding = (encoding: SubtitleEncoding): void => {
    if (!state.filePath || !state.externalSubtitlePath) return
    void loadExternalSubtitle(
      { ...openSession(), externalSubtitleEncoding: encoding },
      state.filePath,
      state.externalSubtitlePath
    ).then((warning) => {
      if (warning) recentFiles.reportError(warning)
    })
  }

  // Video menu > frame stepping, shared by both directions. The guard drops
  // repeat presses while a step is still in flight.
  const handleFrameStep = (direction: 'forward' | 'back'): void => {
    frameStepAction(
      window.kizuna.player,
      direction,
      state.filePath !== undefined,
      frameStepGuard.current
    )
  }

  // Video menu > "Adjustments…" panel: applies the new picture-adjustments block
  // to mpv live and persists it app-wide (not per file). The ref is updated in
  // lockstep so the per-load re-apply reads the latest value.
  const handleChangeVideoAdjustments = (next: VideoAdjustmentsValue): void => {
    videoAdjustmentsRef.current = next
    dispatch({ type: 'setVideoAdjustments', value: next })
    applyVideoAdjustments(window.kizuna.player, next)
  }

  // Subtitle menu > "Apply to folder": makes the current offset the default for
  // every video in this file's folder, present and future.
  const handleApplyOffsetToFolder = (): void => {
    if (!state.filePath) return
    applyOffsetToFolder(
      { subtitleOffsets: subtitleOffsetsRef, folderSubtitleOffsets: folderSubtitleOffsetsRef },
      state.filePath,
      state.subtitleOffsetMs,
      (patch) => settingsPersistenceRef.current.schedule(patch)
    )
  }

  // Resizes the app window so the embedded mpv video renders at `scale` ×
  // its native resolution (clamped to the display's available area). No-op
  // if the current file's video dimensions aren't known yet (e.g. audio-only
  // file, or still loading). The open side panels are measured from the same
  // refs useVideoMargins observes: mpv takes their width out of the video
  // area, so the window has to be that much wider for the picture to keep the
  // requested scale. Stable identity so the re-apply effect below can depend
  // on it without re-firing every render.
  const applyVideoScale = useLatestCallback((scale: number): void => {
    const size = videoScaleWindowSize(
      videoDimensions,
      scale,
      topBarRef.current?.offsetHeight ?? 0,
      bottomBarRef.current?.offsetHeight ?? 0,
      { width: window.screen.availWidth, height: window.screen.availHeight },
      leftSidebarStackRef.current?.offsetWidth ?? 0,
      rightSidebarStackRef.current?.offsetWidth ?? 0
    )
    if (size) window.kizuna.windowControls.setSize(size.width, size.height)
  })

  const handleSetVideoScale = (scale: number): void => {
    setRequestedVideoScale(scale)
    // Applied here as well as from the effect below: re-picking the preset
    // that is already remembered leaves the state untouched, and the user
    // (who may have hand-resized the window since) still expects a resize.
    applyVideoScale(scale)
  }

  // Re-measures the preservation baseline from the window as it stands now.
  // Only ever called outside a panel transition: mid-transition the panels are
  // already laid out while the window still has its old size, which would fold
  // the panel's width into the baseline and defeat the whole compensation.
  const captureVideoContentBaseline = useLatestCallback((): void => {
    videoContentBaselineRef.current = videoContentBaseline(
      { width: window.innerWidth, height: window.innerHeight },
      leftSidebarStackRef.current?.offsetWidth ?? 0,
      rightSidebarStackRef.current?.offsetWidth ?? 0
    )
  })

  // Resizes the window so the video keeps the dimensions it had before the
  // panel transition, for the default/unmodified size (no preset picked). The
  // baseline is the rectangle measured before this transition, so the window
  // simply carries whichever panels are open now on top of it.
  const applySidebarSizeCompensation = useLatestCallback((): void => {
    if (state.fullscreen || miniPlayerActive) return
    // Same guard the preset path uses: with no video stream there is no picture
    // to preserve, so the window is left exactly where the user put it.
    if (!videoDimensions) return
    const size = sidebarPreservingWindowSize(
      videoContentBaselineRef.current,
      { width: window.screen.availWidth, height: window.screen.availHeight },
      leftSidebarStackRef.current?.offsetWidth ?? 0,
      rightSidebarStackRef.current?.offsetWidth ?? 0
    )
    if (size) window.kizuna.windowControls.setSize(size.width, size.height)
  })

  // Keeps the baseline current between panel transitions. The window resizing —
  // by the user's drag, a size preset, or our own compensation — is the only
  // thing that legitimately changes the video rectangle, so re-measuring on
  // `resize` is both the staleness fix and the way a clamped compensation
  // settles into the new (smaller) rectangle. Panel toggles deliberately do not
  // re-run this: their deps are absent. `settingsReady` lets restored panels
  // establish the startup baseline; `videoDimensions` rebases layouts changed
  // while no video dimensions were available before later transitions.
  useEffect(() => {
    if (state.fullscreen || miniPlayerActive) return
    captureVideoContentBaseline()
    const onResize = (): void => captureVideoContentBaseline()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [
    state.fullscreen,
    miniPlayerActive,
    settingsReady,
    videoDimensions,
    captureVideoContentBaseline
  ])

  // True once the restored panel layout has been observed, so the panels
  // reopened at startup establish the baseline instead of counting as a
  // transition to compensate for.
  const panelLayoutObservedRef = useRef(false)

  // Keeps the visible video the same size across panel toggles: opening or
  // closing a side panel changes how much window width mpv's margins reserve,
  // so the window has to grow or shrink by that width instead of the picture
  // doing it. With an explicit Video ▸ Size preset the preset is re-applied;
  // otherwise the default size is preserved against the measured baseline.
  // Runs post-commit, so the sidebar refs measure the panel's real width.
  useEffect(() => {
    if (requestedVideoScale !== undefined) {
      applyVideoScale(requestedVideoScale)
      return
    }
    if (!settingsReady) return
    if (!panelLayoutObservedRef.current) {
      panelLayoutObservedRef.current = true
      return
    }
    applySidebarSizeCompensation()
  }, [
    settingsReady,
    sidebarOpen,
    playlistOpen,
    requestedVideoScale,
    applyVideoScale,
    applySidebarSizeCompensation
  ])

  const handleToggleAlwaysOnTop = (): void => {
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    window.kizuna.windowControls.setAlwaysOnTop(next)
  }

  const handleToggleSidebar = (): void => {
    toggleSidebar(sidebarOpen, setSidebarOpen, (patch) =>
      settingsPersistenceRef.current.schedule(patch)
    )
  }

  const handleTogglePlaylist = (): void => {
    const next = !playlistOpen
    setPlaylistOpen(next)
    settingsPersistenceRef.current.schedule({ playlistOpen: next })
  }

  const handleNavigateFile = useCallback(
    (direction: 'prev' | 'next'): void => {
      performFileNavigation(direction, {
        playlistActive: playlistController.isPlaybackCurrent(stateRef.current.filePath),
        onNextFile: () => void handleOpenNeighbor('next'),
        onPrevFile: () => void handleOpenNeighbor('prev'),
        onPlaylistNext: () => void playlistController.next(playlistLoadDeps()),
        onPlaylistPrev: () => void playlistController.prev(playlistLoadDeps())
      })
    },
    [handleOpenNeighbor, playlistController, playlistLoadDeps, stateRef]
  )

  // Binds the queue seams (`appendPathsToPlaylist`/`appendPlaylistFile` are pure
  // module functions) to the live preload API and playlist controller.
  const playlistAppendDeps = (): PlaylistAppendDeps => ({
    readPlaylist: (path) => window.kizuna.media.readPlaylist(path),
    addPaths: async (paths) => {
      await playlistController.addPathsAndMaybePlay(
        paths,
        stateRef.current.filePath !== undefined,
        playlistLoadDeps()
      )
    }
  })

  const handleAddFilesToPlaylist = async (): Promise<void> => {
    await appendPathsToPlaylist(await window.kizuna.media.openFiles(), playlistAppendDeps())
  }

  const handleAddFolderToPlaylist = async (): Promise<void> => {
    await appendPathsToPlaylist(await window.kizuna.media.openFolder(), playlistAppendDeps())
  }

  const handleSavePlaylist = (): void => {
    void window.kizuna.media.savePlaylist(playlistController.getState().playlist.entries)
  }

  // Opens a network stream (Feature 9). Routes through the same open pipeline
  // as files, so the `mediaOpening` lock, recents refresh and error banner all
  // apply; loadPath skips ffprobe for the URL. The dialog closes only on a
  // successful open — a failure/timeout/cancel keeps it up so the error banner
  // is visible and the user can retry. Cancel and the load timeout both release
  // the lock through the pipeline's own finally.
  const handleOpenUrl = async (url: string): Promise<void> => {
    const result = await openPath(url)
    if (result.status === 'opened') setOpenUrlDialogOpen(false)
  }

  // Mirrored every render so a command awaiting a native dialog can ask which
  // video is playing *now* instead of trusting the closure it captured.
  const currentFilePathRef = useLatestRef(state.filePath)

  // Drag-and-drop (F17/F18): a dropped video opens like a Media-menu pick; a
  // dropped .srt/.ass/.ssa becomes the current video's subtitle track.
  const handleDrop = (files: File[]): Promise<void> => {
    const filePath = state.filePath
    return handleDroppedFiles(files, {
      hasVideo: filePath !== undefined,
      currentFilePath: () => currentFilePathRef.current,
      pathForFile: (file) => window.kizuna.files.pathForFile(file),
      openPath: (path) => openPath(path),
      loadSubtitle: (videoPath, path) => loadExternalSubtitle(openSession(), videoPath, path),
      appendPlaylistFile: (path) => appendPlaylistFile(path, playlistAppendDeps()),
      reportError: (message) => recentFiles.reportError(message)
    })
  }
  // Mirrored every render (like showWordPopupRef) so the mount-once listeners
  // below always call the handler bound to the current state.
  const handleDropRef = useLatestRef(handleDrop)

  // Subtitle menu > "Load subtitle file…" — the dialog twin of dropping a
  // subtitle file. The menu item is hidden without a video (see the MenuBar
  // prop below); the guard here is what makes that a type-level fact.
  const handleLoadSubtitleFile = (): Promise<void> => {
    const filePath = state.filePath
    if (filePath === undefined) return Promise.resolve()
    return loadSubtitleFromPicker({
      expectedFilePath: filePath,
      currentFilePath: () => currentFilePathRef.current,
      pickPath: () => window.kizuna.media.openSubtitleFile(),
      session: openSession(),
      reportError: (message) => recentFiles.reportError(message)
    })
  }

  // preventDefault on *both* events, or Chromium navigates the window to the
  // dropped file instead of handing it to us.
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => event.preventDefault()
    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      void handleDropRef.current(Array.from(event.dataTransfer?.files ?? []))
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [handleDropRef])

  useEffect(() => {
    if (!loopCue) return
    const target = loopSeekTarget(loopCue, state.timePos, state.subtitleOffsetMs)
    if (target !== undefined) void window.kizuna.player.seek(target, true)
  }, [state.timePos, loopCue, state.subtitleOffsetMs])

  const activeCue = findActiveCue(state.cues, offsetTimePos(state.timePos, state.subtitleOffsetMs))
  const activeCueKey = activeCue ? cueKey(activeCue) : undefined

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
      recentFiles.reportTransient(`Screenshot saved: ${path}`)
    } catch (err) {
      recentFiles.reportError(errorMessage(err))
    }
  }
  const keyContext: KeyboardShortcutContext = {
    player: playerAdapter,
    windowControls: {
      toggleFullscreen: toggleFullscreenFromKey,
      setFullscreen: (fullscreen) => window.kizuna.windowControls.setFullscreen(fullscreen)
    },
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
    onFrameStep: () =>
      frameStepAction(
        window.kizuna.player,
        'forward',
        state.filePath !== undefined,
        frameStepGuard.current
      ),
    onFrameBack: () =>
      frameStepAction(
        window.kizuna.player,
        'back',
        state.filePath !== undefined,
        frameStepGuard.current
      ),
    onNavigateLine: () => setLoopCue(null),
    onPrevFile: () => handleNavigateFile('prev'),
    onNextFile: () => handleNavigateFile('next'),
    onScreenshot: () => void handleScreenshot(),
    onToggleMiniPlayer: () => void handleToggleMiniPlayer(),
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
      reportOpen ||
      openUrlDialogOpen ||
      cardImageRequest !== null ||
      miningPresentation === 'modal'
  })

  const japaneseSubtitleSelected = isJapaneseSubtitleTrack(state.tracks, state.selectedSubtitleId)

  // Active-cue tokenization, tokenize-all (sidebar), whole-track vocabulary,
  // and F1 subtitle-report recomputation — see state/useVocabularyPipeline.ts.
  const { prepareWholeTrackVocabulary, vocabularySpans } = useVocabularyPipeline({
    dispatch,
    bridges: {
      mecab: kizuna.mecab,
      knowledge: kizuna.knowledge,
      dict: kizuna.dict
    },
    cues: state.cues,
    activeCue,
    activeCueKey,
    allCueTokens: state.allCueTokens,
    activeTokens: state.activeTokens,
    japaneseSubtitleSelected,
    sidebarOpen,
    reportOpen,
    filePath: state.filePath,
    selectedSubtitleId: state.selectedSubtitleId,
    frequencyDictId: state.popupSettings.frequencyDictId,
    sortOrder: state.popupSettings.sortOrder,
    dictionarySettings: dictionariesState.data,
    knowledgeEpoch: state.knowledgeEpoch,
    tokenCacheRef: tokenCache,
    tokenizeTokenRef: tokenizeToken,
    knownLevelsCacheRef: knownLevelsCache,
    knownLevelsTokenRef: knownLevelsToken,
    allCuesTokenRef: allCuesToken,
    allCuesLevelsTokenRef: allCuesLevelsToken,
    wholeTrackVocabularyRef,
    vocabularySpanEpochRef: vocabularySpanEpoch,
    vocabularySpansByCue,
    setVocabularySpansByCue,
    reportController
  })

  // SubtitleSidebar row click: jumps playback to the clicked cue's start,
  // respecting the current subtitle offset the same way the overlay's active
  // cue is resolved (see seekTargetForCue).
  const handleSelectSidebarCue = (cue: Cue): void => {
    window.kizuna.player.seek(seekTargetForCue(cue, state.subtitleOffsetMs), true)
  }

  const handleCopySidebarCue = (cue: Cue): void => {
    void copySidebarCue(window.kizuna.clipboard.writeText, cue)
  }

  const handleTranslateSidebarCue = (cue: Cue, requestId: string): Promise<string> =>
    window.kizuna.translate.translate(cue.text, requestId)

  // Looks up a token's dictionary entries and opens/pins the word popup at the
  // triggering mouse event's viewport coordinates. Shared by both hover (preview)
  // and click (pin) — hover shows it as the mouse passes over a word, click
  // re-fetches at the click position so a keyboard/touch-less pointer still gets
  // an anchored popup even if hover never fired (e.g. touch input).
  const showWordPopup = async (token: Token, event?: React.MouseEvent): Promise<void> => {
    // Anchor above the whole subtitle box (not the hovered word) so the
    // popup never covers a different subtitle line than the one that was
    // hovered. Read synchronously, before the await, since the DOM node's
    // rect can change while the lookup is in flight.
    const subtitleRect = document.getElementById('subtitle')?.getBoundingClientRect()
    const position = wordPopupPosition(subtitleRect, event)
    await popupController.open(window.kizuna.dict, window.kizuna.anki, window.kizuna.knowledge, {
      token,
      position,
      frequencyDictId: state.popupSettings.frequencyDictId,
      sortOrder: state.popupSettings.sortOrder,
      cueTokens: state.activeTokens,
      sentence: activeCue?.text ?? '',
      cueStart: activeCue?.start,
      cueEnd: activeCue?.end
    })
  }

  // Navigates the open popup to a glossary cross-reference link's target
  // term (WordPopup's onLinkClick) — see popupController.openLink.
  const handleWordLinkClick = async (term: string): Promise<void> => {
    await popupController.openLink(
      window.kizuna.dict,
      term,
      state.popupSettings.frequencyDictId,
      state.popupSettings.sortOrder
    )
  }

  // Restores the previous popup payload pushed by handleWordLinkClick.
  const handleWordPopupBack = (): void => {
    popupController.back()
  }

  // Where a mined line's audio could be clipped from. `mineMediaContext`
  // rejects a remote URL, a missing audio selection, and unusable cue timing,
  // so this can be passed unconditionally.
  const mineMediaSource = (): MineMediaSource => ({
    filePath: state.filePath,
    audioStreamIndex: state.selectedAudioId,
    subtitleOffsetMs: state.subtitleOffsetMs
  })

  // Mines the clicked/selected dictionary entry into Anki. Word audio is
  // derived entirely from `wordPopup.token` by the main-process note builder.
  // A picture is different: it must be captured from mpv now, so when the user
  // enabled screenshots and mapped a Picture field and a video is loaded, the
  // frame is grabbed first and the mine waits on the crop dialog's decision. A
  // failed capture (or an audio-only file) mines the card exactly as before.
  const handleAddToAnki = async (result: LookupResult): Promise<void> => {
    const imageBase64 = await popupController.captureCardImage(
      window.kizuna.player,
      state.filePath !== undefined
    )
    if (imageBase64) {
      setCardImageRequest({ imageBase64, result })
      return
    }
    await popupController.addToAnki(window.kizuna.anki, result, undefined, mineMediaSource())
  }

  // The crop dialog's outcome: a base64 JPEG mines the card with it, null mines
  // it without a picture. Cancel closes the dialog without mining at all.
  const handleCardImageSubmit = (jpegBase64: string | null): void => {
    const request = cardImageRequest
    setCardImageRequest(null)
    if (!request) return
    void popupController.addToAnki(
      window.kizuna.anki,
      request.result,
      jpegBase64 ? { dataBase64: jpegBase64 } : undefined,
      mineMediaSource()
    )
  }

  // "Open in Anki" button's click handler — opens the already-mined word's
  // card in Anki's Browse window (see ankiExisting/showWordPopup).
  const handleOpenAnkiCard = async (cardId: number): Promise<void> => {
    await popupController.openCard(window.kizuna.anki, cardId)
  }

  // Always call through this stable wrapper (not showWordPopup directly) from
  // the hover debouncer below, so the debounced callback — created once and
  // never recreated — still sees the latest popupSettings/state on every settle.
  const showWordPopupLatest = useLatestCallback(showWordPopup)

  // Hover-intent: onMouseEnter fires per token the pointer passes over, but a
  // token merely swept past while moving the mouse elsewhere should never
  // replace the currently-shown popup — only a token the pointer rests on
  // for HOVER_DELAY_MS does. Click bypasses the delay (explicit action).
  const HOVER_DELAY_MS = 250
  const [hoverDebouncer] = useState<HoverDebouncer<{ token: Token; event?: React.MouseEvent }>>(
    () =>
      createHoverDebouncer(HOVER_DELAY_MS, ({ token, event }) => {
        void showWordPopupLatest(token, event)
      })
  )
  useEffect(() => () => hoverDebouncer.cancel(), [hoverDebouncer])

  const onWordHover = (token: Token, event?: React.MouseEvent): void => {
    hoverDebouncer.onEnter({ token, event })
  }
  const onWordLeave = (): void => {
    hoverDebouncer.cancel()
  }
  const onWordClick = (token: Token, event?: React.MouseEvent): void => {
    hoverDebouncer.cancel()
    if (!shouldOpenWordPopup(window.getSelection())) return
    void showWordPopup(token, event)
  }

  // Shared by WordPopup's own close button and the outside-click effect
  // below, so both paths tear down the same state (the pending hover timer,
  // plus any link-navigation history) instead of drifting apart.
  const closeWordPopup = useLatestCallback((): void => {
    hoverDebouncer.cancel()
    popupController.close()
  })

  // Closes the popup on a mousedown anywhere outside its own DOM node (e.g.
  // on the video/subtitle area) — WordPopup always renders in the DOM (CSS
  // toggles visibility), so '#word-popup' is a stable query target whether
  // or not it's currently open. Only listens while a popup is actually open,
  // and never while the mined-card picture dialog owns the interaction (see
  // shouldClosePopupOnPointerDown).
  useEffect(() => {
    if (!wordPopup) return
    const handlePointerDown = (event: MouseEvent): void => {
      if (
        shouldClosePopupOnPointerDown(
          document.getElementById('word-popup'),
          event.target as Node,
          cardImageRequest !== null
        )
      ) {
        closeWordPopup()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [wordPopup, closeWordPopup, cardImageRequest])

  // Switches the active MeCab dictionary: persists the choice (via B3
  // settings, inside selectDict on the main side), then invalidates every
  // cached tokenization (a cue's tokens depend on which dictionary produced
  // them) and re-tokenizes the currently-displayed cue so the subtitle
  // reflects the new dictionary immediately.
  const handleSelectMecabDict = async (id: 'ipadic' | 'unidic'): Promise<void> => {
    await selectMecabDict({
      mecab: window.kizuna.mecab,
      knowledge: window.kizuna.knowledge,
      dispatch,
      activeCue,
      cues: state.cues,
      sidebarOpen,
      tokenCache: tokenCache.current,
      knownLevelsCache: knownLevelsCache.current,
      activeToken: tokenizeToken.current,
      allCuesToken: allCuesToken.current,
      allCuesLevelsToken: allCuesLevelsToken.current,
      optionsData,
      id
    })
    wholeTrackVocabularyRef.current.invalidate()
    vocabularySpanEpoch.current++
    setVocabularySpansByCue({})
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

  const handleSaveWanikaniToken = async (token: string): Promise<void> => {
    await saveWanikaniToken(window.kizuna.knowledge, optionsData, token)
    if (token === '') {
      // Clearing the token already purged the WaniKani rows main-side — there
      // is nothing to sync, but cached levels must drop immediately.
      await refreshKnownLevels({
        knowledge: window.kizuna.knowledge,
        dispatch,
        activeTokens: state.activeTokens,
        allCueTokens: state.allCueTokens,
        sidebarOpen,
        knownLevelsCache: knownLevelsCache.current,
        activeLevelsToken: knownLevelsToken.current,
        allCuesLevelsToken: allCuesLevelsToken.current
      })
      return
    }
    // A new token syncs right away: an invalid one errors out and leaves zero
    // WaniKani words (the purge above the sync), never the old token's data.
    await handleSyncNow('wanikani', true)
  }

  const handleChangeAnkiSettings = async (patch: Partial<AnkiSettings>): Promise<void> => {
    await changeAnkiSettings(window.kizuna.anki, optionsData, patch)
  }

  const handleChangeKnowledgeSettings = async (
    patch: Partial<Omit<PublicKnowledgeSettings, 'hasWanikaniToken' | 'encryptionAvailable'>>
  ): Promise<void> => {
    await changeKnowledgeSettings(window.kizuna.knowledge, optionsData, patch)
    if (shouldResyncAnkiForKnowledgePatch(patch)) {
      await handleSyncNow('anki', true)
    }
  }

  const handleSyncNow = async (source: KnowledgeSource, force?: boolean): Promise<SyncStatus> => {
    return syncKnowledgeAndRefresh({
      knowledge: window.kizuna.knowledge,
      dispatch,
      activeTokens: state.activeTokens,
      allCueTokens: state.allCueTokens,
      sidebarOpen,
      knownLevelsCache: knownLevelsCache.current,
      activeLevelsToken: knownLevelsToken.current,
      allCuesLevelsToken: allCuesLevelsToken.current,
      optionsData,
      source,
      force
    })
  }
  const handleSyncNowRef = useLatestRef(handleSyncNow)

  const closeMining = useLatestCallback((): void => {
    miningSessionToken.current++
    bulkMiningController.close()
    miningCompletionTrackerRef.current.reset()
    setMiningCompletion(null)
    setMiningPresentation('closed')
  })

  const openMining = (): void => {
    if (miningPresentation === 'sidebar') {
      setMiningPresentation(reopenBulkMiningModal(miningPresentation))
      return
    }
    if (miningPresentation === 'modal') return
    ++miningSessionToken.current
    setReportOpen(false)
    reportController.close()
    setMiningPresentation('modal')
    void bulkMiningController.open({
      bridges: {
        dict: window.kizuna.dict,
        anki: window.kizuna.anki,
        knowledge: window.kizuna.knowledge
      },
      snapshot: prepareWholeTrackVocabulary,
      cues: state.cues,
      frequencyDictId: state.popupSettings.frequencyDictId,
      sortOrder: state.popupSettings.sortOrder
    })
  }

  // A file or subtitle-track switch invalidates the mining session, including
  // one currently hidden in the compact sidebar. Run as the cleanup of the
  // outgoing cue list/track so the teardown fires on exactly the same
  // transitions, without the effect body itself writing state.
  const invalidateMiningRef = useLatestRef((): void => {
    miningSessionToken.current++
    if (miningPresentation !== 'closed') closeMining()
  })
  useEffect(
    () => () => invalidateMiningRef.current(),
    [state.cues, japaneseSubtitleSelected, invalidateMiningRef]
  )

  useEffect(() => {
    const controller = bulkMiningController
    return controller.subscribe(() => {
      const phase = controller.getState()
      const event = miningCompletionTrackerRef.current.observe(phase)
      if (phase.kind === 'running') setMiningCompletion(null)
      if (!event) return
      setMiningCompletion(event)
      if (event.shouldPause && !pausedRef.current) void playerAdapter.setPause(true)
      if (event.shouldRefreshKnowledge) void handleSyncNowRef.current('anki', true)
    })
  }, [playerAdapter, bulkMiningController, handleSyncNowRef, pausedRef])

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
            tracks={state.tracks}
            selectedAudioId={state.selectedAudioId}
            selectedSubtitleId={state.selectedSubtitleId}
            hasFile={state.filePath !== undefined}
            onPrevFile={() => handleNavigateFile('prev')}
            onNextFile={() => handleNavigateFile('next')}
            onOpenFile={() => recentFiles.openPicker(openSession())}
            onSelectAudio={handleSelectAudio}
            audioDelayMs={state.audioDelayMs}
            onChangeAudioDelay={handleAudioDelayChange}
            onSelectSubtitle={handleSelectSubtitle}
            onLoadSubtitleFile={state.filePath ? () => void handleLoadSubtitleFile() : undefined}
            externalSubtitleEncoding={state.externalSubtitleEncoding}
            onChangeExternalSubtitleEncoding={handleChangeExternalSubtitleEncoding}
            urlSubtitleMenu={urlSubtitleState.menu}
            preferredUrlSubtitleLanguage={state.preferredUrlSubtitleLanguage}
            urlSubtitleSelectedId={urlSubtitleState.selectedId}
            urlSubtitleAcquiring={urlSubtitleState.acquiring}
            onSelectUrlSubtitle={(selectionId) => urlSubtitleController.select(selectionId)}
            onSelectUrlSubtitleOff={() => urlSubtitleController.selectOff()}
            onOpenOptions={() => setOptionsOpen(true)}
            onOpenChange={setMenuBarOpen}
            subtitleOffsetMs={state.subtitleOffsetMs}
            onChangeSubtitleOffset={handleSubtitleOffsetChange}
            onApplyOffsetToFolder={state.filePath ? handleApplyOffsetToFolder : undefined}
            speed={state.speed}
            onSetSpeed={(speed) => void playerAdapter.setSpeed(speed)}
            onSetVideoScale={handleSetVideoScale}
            abLoop={state.abLoopState}
            onCycleAbLoop={handleCycleAbLoop}
            onFrameStep={() => handleFrameStep('forward')}
            onFrameBack={() => handleFrameStep('back')}
            onOpenVideoAdjustments={() => setVideoAdjustmentsOpen(true)}
            qualityVisible={qualityVisible}
            quality={displayedYtdlpQuality}
            qualityReloading={qualityReloading}
            onSetYtdlpQuality={(quality) => void handleSetYtdlpQuality(quality)}
            alwaysOnTop={alwaysOnTop}
            onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
            miniPlayer={miniPlayerActive}
            onToggleMiniPlayer={() => void handleToggleMiniPlayer()}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={handleToggleSidebar}
            playlistOpen={playlistOpen}
            onTogglePlaylist={handleTogglePlaylist}
            onAddFiles={() => void handleAddFilesToPlaylist()}
            onAddFolder={() => void handleAddFolderToPlaylist()}
            onSavePlaylist={handleSavePlaylist}
            hasPlaylist={playlistState.playlist.entries.length > 0}
            onOpenWordReport={() => setReportOpen(true)}
            onOpenBulkMining={() => void openMining()}
            recentFiles={recentFilesState.recentFiles}
            mediaOpening={recentFilesState.mediaOpening}
            onOpenRecent={(path) => recentFiles.openRecent(openSession(), path)}
            onClearRecentFiles={() => recentFiles.clearRecent(window.kizuna)}
            onOpenUrl={() => setOpenUrlDialogOpen(true)}
          />
        )}
      </div>

      {recentFilesState.errorMessage && (
        <div id="media-error" role="alert">
          <span>{recentFilesState.errorMessage}</span>
          <button type="button" aria-label="Dismiss" onClick={() => recentFiles.dismissError()}>
            ×
          </button>
        </div>
      )}

      <div id="player-area">
        {playlistOpen && !state.fullscreen && !miniPlayerActive && (
          <aside id="left-sidebar-stack" ref={leftSidebarStackRef} aria-label="Playlist">
            <PlaylistSidebar
              entries={playlistState.playlist.entries}
              currentIndex={playlistState.playlist.currentIndex}
              missing={playlistState.missing}
              repeat={playlistState.playlist.repeat}
              shuffle={playlistState.playlist.shuffle}
              onPlay={(index) => void playlistController.playAt(index, playlistLoadDeps())}
              onRemove={(index) => playlistController.removeAt(index)}
              onMove={(from, to) => playlistController.moveEntry(from, to)}
              onSetRepeat={(mode) => playlistController.setRepeat(mode)}
              onToggleShuffle={() => playlistController.setShuffle(!playlistState.playlist.shuffle)}
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
            vocabularySpans={activeCueKey ? vocabularySpansByCue[activeCueKey] : undefined}
            style={miniPlayerSubtitleStyle(state.subtitleStyle, miniPlayerActive)}
            highlightedTokens={japaneseSubtitleSelected ? wordPopup?.highlightedTokens : undefined}
            onWordHover={japaneseSubtitleSelected ? onWordHover : undefined}
            onWordClick={japaneseSubtitleSelected ? onWordClick : undefined}
            onWordLeave={japaneseSubtitleSelected ? onWordLeave : undefined}
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
                  vocabularySpans={vocabularySpans}
                  onSelectCue={handleSelectSidebarCue}
                  onCopyCue={handleCopySidebarCue}
                  onTranslateCue={state.translationEnabled ? handleTranslateSidebarCue : undefined}
                  createTranslationRequestId={
                    state.translationEnabled ? () => crypto.randomUUID() : undefined
                  }
                  onCancelTranslation={
                    state.translationEnabled
                      ? (requestId) => window.kizuna.translate.cancel(requestId)
                      : undefined
                  }
                />
              )}
              {miningPresentation === 'sidebar' && (
                <BulkMiningSidebar
                  phase={bulkMiningPhase}
                  onReopen={() => setMiningPresentation(reopenBulkMiningModal(miningPresentation))}
                  onCancel={() => bulkMiningController.cancel()}
                />
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
        onToggleFullscreen={toggleFullscreen}
        miniPlayer={miniPlayerActive}
        onExitMiniPlayer={() => void handleToggleMiniPlayer()}
        onSetSpeed={(speed) => void playerAdapter.setSpeed(speed)}
        sidebarOpen={sidebarOpen}
        playlistOpen={playlistOpen}
        onToggleSidebar={handleToggleSidebar}
        onTogglePlaylist={handleTogglePlaylist}
        player={playerAdapter}
        containerRef={bottomBarRef}
        mediaPath={state.filePath}
        thumbnailsEnabled={
          videoDimensions !== undefined &&
          state.filePath !== undefined &&
          shouldProbe(state.filePath)
        }
      />

      <VideoAdjustments
        open={videoAdjustmentsOpen}
        adjustments={state.videoAdjustments}
        onChange={handleChangeVideoAdjustments}
        onClose={() => setVideoAdjustmentsOpen(false)}
      />

      <OpenUrlDialog
        open={openUrlDialogOpen}
        loading={recentFilesState.mediaOpening}
        recentUrls={recentFilesState.recentFiles.map((file) => file.path).filter(isRemoteUrl)}
        onSubmit={(url) => void handleOpenUrl(url)}
        onCancelLoad={() => void window.kizuna.player.cancelLoad()}
        onClose={() => setOpenUrlDialogOpen(false)}
      />

      <OptionsMenu
        open={optionsOpen}
        keyBindings={state.keyBindings}
        heldModifiers={modifiers.held}
        skipSeconds={state.skipSeconds}
        rightClickTogglePause={state.rightClickTogglePause}
        autoPlayNext={state.autoPlayNext}
        audioDevices={audioDeviceController.devices}
        selectedAudioDevice={effectiveAudioDevice(state.audioDevice, audioDeviceController.devices)}
        onSelectAudioDevice={audioDeviceController.selectDevice}
        loudnessNormalization={state.loudnessNormalization}
        onToggleLoudnessNorm={handleToggleLoudnessNorm}
        onAudioDevicesRequest={audioDeviceController.requestDevices}
        screenshotFolder={state.screenshotFolder}
        mpvUserConfig={state.mpvUserConfig}
        mpvExtraArgs={state.mpvExtraArgs}
        mecabDicts={dictionariesData.mecabDicts}
        currentMecabDictId={dictionariesData.currentMecabDictId}
        yomitanDicts={dictionariesData.yomitanDicts}
        dictionariesLoadError={dictionariesState.error}
        popupSettings={state.popupSettings}
        subtitleStyle={state.subtitleStyle}
        subtitleDragEnabled={state.subtitleDragEnabled}
        translationEnabled={state.translationEnabled}
        preferredUrlSubtitleLanguage={state.preferredUrlSubtitleLanguage}
        appearance={state.appearance}
        levelColors={state.levelColors}
        onClose={() => {
          setOptionsOpen(false)
          void settingsPersistenceRef.current.flush()
        }}
        onChangeKeyBinding={(action, binding) =>
          dispatch({ type: 'setKeyBinding', action, binding })
        }
        onChangeSkipSeconds={(value) => dispatch({ type: 'setSkipSeconds', value })}
        onChangeRightClickTogglePause={(value) =>
          dispatch({ type: 'setRightClickTogglePause', value })
        }
        onChangeAutoPlayNext={(value) => dispatch({ type: 'setAutoPlayNext', value })}
        onChangeScreenshotFolder={(value) => dispatch({ type: 'setScreenshotFolder', value })}
        onChangeMpvUserConfig={(value) => dispatch({ type: 'setMpvUserConfig', value })}
        onChangeMpvExtraArgs={(value) => dispatch({ type: 'setMpvExtraArgs', value })}
        onOpenMpvConfigDir={() => {
          // openMpvConfigDir resolves the shell.openPath result: a non-empty
          // string is an OS-level failure message; a rejection means the IPC
          // itself failed. Surface either through the same error banner load
          // errors use, so the click never silently no-ops.
          void window.kizuna.playerSettings.openMpvConfigDir().then(
            (error) => {
              if (error) {
                recentFiles.reportError(`Could not open the mpv config folder: ${error}`)
              }
            },
            () => recentFiles.reportError('Could not open the mpv config folder.')
          )
        }}
        onSelectMecabDict={handleSelectMecabDict}
        onImportYomitanDict={handleImportYomitanDict}
        subscribeImportProgress={handleSubscribeImportProgress}
        onSetYomitanEnabled={handleSetYomitanEnabled}
        onSetYomitanFallbackOnly={handleSetYomitanFallbackOnly}
        onReorderYomitanDicts={handleReorderYomitanDicts}
        onRemoveYomitanDict={handleRemoveYomitanDict}
        onChangePopupSettings={(value) => dispatch({ type: 'setPopupSettings', value })}
        onChangeSubtitleStyle={(value) => dispatch({ type: 'setSubtitleStyle', value })}
        onChangeSubtitleDragEnabled={(value) => dispatch({ type: 'setSubtitleDragEnabled', value })}
        onChangeTranslationEnabled={(value) => {
          dispatch({ type: 'setTranslationEnabled', value })
          settingsPersistenceRef.current.schedule({ translationEnabled: value })
        }}
        onChangePreferredUrlSubtitleLanguage={(value) => {
          dispatch({ type: 'setPreferredUrlSubtitleLanguage', value })
          settingsPersistenceRef.current.schedule({ preferredUrlSubtitleLanguage: value })
        }}
        onChangeAppearance={(value) => dispatch({ type: 'setAppearance', value })}
        onChangeLevelColor={(level, color) => dispatch({ type: 'setLevelColor', level, color })}
        wanikaniConfigured={knowledgeSettings.hasWanikaniToken}
        onSaveWanikaniToken={handleSaveWanikaniToken}
        ankiSettings={ankiState.data?.settings}
        ankiDeckNames={ankiState.data?.deckNames}
        ankiModelNames={ankiState.data?.modelNames}
        ankiModelFields={ankiState.data?.modelFields}
        ankiPing={() => window.kizuna.anki.ping()}
        onChangeAnkiSettings={handleChangeAnkiSettings}
        ankiLoadError={ankiState.error}
        knowledgeSettings={knowledgeSettings}
        onChangeKnowledgeSettings={handleChangeKnowledgeSettings}
        knowledgeLoadError={knowledgeState.error}
        syncStatus={syncStatus}
        setupStatus={setupState.data}
        onSyncNow={handleSyncNow}
        onCategoryOpen={handleOptionsCategoryOpen}
      />

      <WordPopup
        results={wordPopup?.results ?? []}
        position={wordPopup?.position ?? null}
        onClose={closeWordPopup}
        maxEntries={state.popupSettings.maxEntries}
        maxMeanings={state.popupSettings.maxMeanings}
        token={wordPopup?.token}
        sentence={wordPopup?.sentence}
        onAddToAnki={handleAddToAnki}
        ankiStatus={ankiStatus}
        ankiError={ankiError}
        ankiExisting={ankiExisting}
        duplicatePolicy={popupState.duplicatePolicy}
        onOpenAnkiCard={handleOpenAnkiCard}
        onLinkClick={handleWordLinkClick}
        onBack={handleWordPopupBack}
        canGoBack={popupHistory.length > 0}
        provenanceByExpression={wordPopup?.provenanceByExpression}
      />

      {cardImageRequest && (
        <CardImageCropDialog
          open
          imageBase64={cardImageRequest.imageBase64}
          onSubmit={handleCardImageSubmit}
          onCancel={() => setCardImageRequest(null)}
        />
      )}

      <SubtitleReport
        open={reportOpen && miningPresentation !== 'modal'}
        phase={reportPhase}
        onClose={() => {
          setReportOpen(false)
          reportController.close()
        }}
        onRetry={() => {
          void reportController.open({
            bridges: { knowledge: window.kizuna.knowledge },
            snapshot: prepareWholeTrackVocabulary
          })
        }}
      />

      {miningPresentation === 'modal' && (
        <BulkMiningModal
          phase={bulkMiningPhase}
          available={japaneseSubtitleSelected && state.cues.length > 0}
          onClose={closeMining}
          onHideToSidebar={() =>
            setMiningPresentation(hideBulkMiningToSidebar(miningPresentation, bulkMiningPhase))
          }
          frequencyDictConfigured={state.popupSettings.frequencyDictId !== null}
          onThresholdChange={(raw) => bulkMiningController.setThreshold(raw)}
          onMinimumCountChange={(raw) => bulkMiningController.setMinimumCount(raw)}
          onSortChange={(sort) =>
            bulkMiningController.setSort(sort, state.popupSettings.frequencyDictId !== null)
          }
          onToggle={(lemma) => bulkMiningController.toggle(lemma)}
          onSelectAll={() =>
            bulkMiningController.selectAllVisible(state.popupSettings.frequencyDictId !== null)
          }
          onSelectNone={() =>
            bulkMiningController.selectNoneVisible(state.popupSettings.frequencyDictId !== null)
          }
          onSetHideTargetDeckMatches={(hide) => bulkMiningController.setHideTargetDeckMatches(hide)}
          targetDeckName={ankiState.data?.settings.deckName}
          onStart={() =>
            void bulkMiningController.start(
              { dict: window.kizuna.dict, anki: window.kizuna.anki },
              mineMediaSource()
            )
          }
          onCancel={() => bulkMiningController.cancel()}
          onBackToList={() =>
            void bulkMiningController.backToList({
              dict: window.kizuna.dict,
              anki: window.kizuna.anki,
              knowledge: window.kizuna.knowledge
            })
          }
          onRetry={() => {
            void bulkMiningController.open({
              bridges: {
                dict: window.kizuna.dict,
                anki: window.kizuna.anki,
                knowledge: window.kizuna.knowledge
              },
              snapshot: prepareWholeTrackVocabulary,
              cues: state.cues,
              frequencyDictId: state.popupSettings.frequencyDictId,
              sortOrder: state.popupSettings.sortOrder
            })
          }}
        />
      )}
      {miningCompletion && (
        <div id="bulk-mining-completion-toast" role="status">
          <span>{miningCompletion.text}</span>
          <button
            type="button"
            aria-label="Dismiss mining completion"
            onClick={() => setMiningCompletion(null)}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
