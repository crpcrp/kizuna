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
import { type MineMediaSource } from './state/ankiMining'
import { seekTargetForCue } from './state/cueNavigation'
import { type SubtitleRequestToken } from './state/mediaSession'
import { cycleAbLoopAction } from './state/playbackCommands'
import { cueKey } from './state/tokenization'
import { wordPopupPosition } from './state/wordLookup'
import { activeLoopCue, loopSeekTarget, replayCue, type LoopSelection } from './state/cueNavigation'
import { appClassName, copySidebarCue, toggleFromRightClick } from './state/appChrome'
import { buildPlayerAdapter } from './state/playerAdapter'
import { miniPlayerSubtitleStyle } from './state/miniPlayer'
import {
  createPopupController,
  createHoverDebouncer,
  shouldClosePopupOnPointerDown,
  shouldOpenWordPopup,
  type HoverDebouncer
} from './state/popupController'
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
import { createSettingsPersistence } from './state/settingsPersistence'
import { useSettingsLifecycle } from './state/useSettingsLifecycle'
import { usePlayerEvents } from './state/usePlayerEvents'
import { useVocabularyPipeline } from './state/useVocabularyPipeline'
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
import { createModifierTracker } from './state/keyBindings'
import { useSubtitleDrag } from './state/useSubtitleDrag'
import { useFullscreenReveal } from './state/useFullscreenReveal'
import { useKeyboardShortcuts, type KeyboardShortcutContext } from './state/useKeyboardShortcuts'
import { useLatestCallback, useLatestRef } from './state/useLatestRef'
import { useMediaSession } from './state/useMediaSession'
import { applyLevelColors } from './util/levelColors'
import { errorMessage } from './util/errorMessage'
import type { KizunaApi } from '../../shared/preloadApi'
import { findActiveCue, offsetTimePos } from '../../shared/cue'
import type { Cue } from '../../shared/cue'
import type { Token } from '../../shared/token'
import { type AudioDevice } from '../../shared/audioDevice'
import type {
  KnowledgeLevel,
  KnowledgeSource,
  PublicKnowledgeSettings,
  SyncStatus
} from '../../shared/knowledge'
import type { LookupResult, ImportProgress } from '../../shared/dictionary'
import type { AnkiSettings } from '../../shared/anki'

// Root React component: the runnable player shell. Wires the reducer + the
// feature hooks that own each workflow (state/useMediaSession.ts for media,
// state/usePlaybackWindow.ts for playback and window, and their siblings) into
// the presentational components (WindowChrome/MenuBar/BottomBar/SubtitleOverlay).
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
  const stateRef = useLatestRef(state)
  const mediaSession = useMediaSession({
    bridge: kizuna,
    dispatch,
    player: playerAdapter,
    state,
    stateRef
  })
  // Per-cue tokenization cache + a request-token guard against stale MeCab
  // resolutions. Held in refs so they persist
  // across renders without themselves triggering one.
  const tokenCache = useRef(new Map<string, Token[]>())
  const tokenizeToken = useRef<SubtitleRequestToken>({ current: 0 })
  // Lemma -> resolved knowledge level, warmed across the whole episode (never
  // cleared per cue, unlike tokenCache) plus a request-token guard against a
  // stale resolveKnownLevels resolution, mirroring tokenizeToken above.
  const knownLevelsCache = useRef(new Map<string, KnowledgeLevel>())
  const knownLevelsToken = useRef<SubtitleRequestToken>({ current: 0 })
  // Whether the all-subtitles side panel (SubtitleSidebar) is shown. Restored
  // from settings.json on mount by useSettingsLifecycle; toggled and persisted
  // by usePlaybackWindow, which also compensates the window size for it.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Whether the playlist (play-queue) side panel is shown, restored and
  // toggled exactly like sidebarOpen above.
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
  // Subtitle report orchestration — see state/subtitleReportController.ts.
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
    suspended:
      optionsOpen ||
      reportOpen ||
      mediaSession.openUrl.open ||
      cardImageRequest !== null ||
      miningPresentation === 'modal'
  })

  const japaneseSubtitleSelected = isJapaneseSubtitleTrack(state.tracks, state.selectedSubtitleId)

  // Active-cue tokenization, tokenize-all (sidebar), whole-track vocabulary,
  // and subtitle-report recomputation — see state/useVocabularyPipeline.ts.
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

  // Switches the active MeCab dictionary: persists the choice (via the
  // settings store, inside selectDict on the main side), then invalidates every
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
            vocabulary={{
              onOpenWordReport: () => setReportOpen(true),
              onOpenBulkMining: () => void openMining()
            }}
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
          onSelectMecabDict: handleSelectMecabDict,
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
          onSaveWanikaniToken: handleSaveWanikaniToken,
          ankiDeckNames: ankiState.data?.deckNames ?? [],
          ankiModelFields: ankiState.data?.modelFields ?? [],
          knowledgeSettings,
          onChangeKnowledgeSettings: handleChangeKnowledgeSettings,
          loadError: knowledgeState.error,
          syncStatus,
          onSyncNow: handleSyncNow
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
