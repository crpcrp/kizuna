import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type RefObject
} from 'react'
import type { Cue } from '../../../shared/cue'
import type {
  KnowledgeLevel,
  KnowledgeSource,
  PublicKnowledgeSettings,
  SyncStatus
} from '../../../shared/knowledge'
import type { LookupResult } from '../../../shared/dictionary'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { Token } from '../../../shared/token'
import type { PlayerApi } from '../components/BottomBar'
import type { BulkMiningModalProps } from '../components/BulkMiningModal'
import type { BulkMiningSidebarProps } from '../components/BulkMiningSidebar'
import type { VocabularyMenuProps } from '../components/menu/VocabularyMenu'
import type { DictionariesTabProps } from '../components/options/DictionariesTab'
import type { KnowledgeTabProps } from '../components/options/KnowledgeTab'
import type { SubtitleOverlayProps } from '../components/SubtitleOverlay'
import type { SubtitleReportProps } from '../components/SubtitleReport'
import type { SubtitleSidebarProps } from '../components/SubtitleSidebar'
import type { WordPopupProps } from '../components/WordPopup'
import { copySidebarCue } from './appChrome'
import type { MineMediaSource } from './ankiMining'
import { createBulkMiningController } from './bulkMiningController'
import {
  createBulkMiningCompletionTracker,
  type BulkMiningCompletionEvent
} from './bulkMiningCompletion'
import {
  hideBulkMiningToSidebar,
  reopenBulkMiningModal,
  type BulkMiningPresentation
} from './bulkMiningPresentation'
import {
  changeKnowledgeSettings,
  saveWanikaniToken,
  selectMecabDict,
  shouldResyncAnkiForKnowledgePatch,
  syncKnowledgeAndRefresh
} from './integrationActions'
import { refreshKnownLevels } from './knowledgeActions'
import type { SubtitleRequestToken } from './mediaSession'
import type { OptionsDataController } from './optionsData'
import type { PlayerAction, PlayerState } from './playerState'
import {
  createHoverDebouncer,
  createPopupController,
  shouldClosePopupOnPointerDown,
  shouldOpenWordPopup,
  type HoverDebouncer
} from './popupController'
import { createSubtitleReportController } from './subtitleReportController'
import { useLatestCallback, useLatestRef } from './useLatestRef'
import { useVocabularyPipeline } from './useVocabularyPipeline'
import type { VocabularySpan } from './vocabularySpans'
import { createWholeTrackVocabularyCoordinator } from './wholeTrackVocabulary'
import { wordPopupPosition } from './wordLookup'

/** Hover-intent delay: onMouseEnter fires for every token the pointer passes
 * over, but only a token it rests on this long opens a popup. Click bypasses
 * it (an explicit action). */
const HOVER_DELAY_MS = 250

type VocabularyMiningState = Pick<
  PlayerState,
  | 'activeTokens'
  | 'allCueTokens'
  | 'cues'
  | 'filePath'
  | 'knowledgeEpoch'
  | 'popupSettings'
  | 'selectedAudioId'
  | 'selectedSubtitleId'
  | 'subtitleOffsetMs'
  | 'translationEnabled'
>

export interface UseVocabularyMiningInput {
  bridge: KizunaApi
  dispatch: Dispatch<PlayerAction>
  player: Pick<PlayerApi, 'setPause'>
  state: VocabularyMiningState
  /** Latest pause flag, so a finished mine only pauses playback that is running. */
  pausedRef: RefObject<boolean>
  /** The cue the overlay is currently showing, and its `cueKey`. */
  activeCue: Cue | undefined
  activeCueKey: string | undefined
  /** False for a non-Japanese (or no) subtitle track: every workflow here is
   * disabled, and the whole-track session is invalidated. */
  japaneseSubtitleSelected: boolean
  /** Whether the all-subtitles panel is open — it is the only consumer of the
   * whole-track tokenization, so it gates that work. */
  sidebarOpen: boolean
  /** The Options dialog's cached integration data, refreshed by the dictionary
   * and knowledge actions below. */
  optionsData: OptionsDataController
  /** Cached dictionary settings; part of the whole-track vocabulary key, since
   * enabling or reordering a dictionary changes the resolved entries. */
  dictionarySettings: unknown
  /** Anki's configured target deck, shown in bulk mining's duplicate filter. */
  targetDeckName: string | undefined
}

export interface CardImageDialogViewModel {
  /** The captured frame awaiting the user's crop decision, if any. */
  imageBase64: string | undefined
  /** A base64 JPEG mines the card with it, null mines it without a picture. */
  onSubmit(jpegBase64: string | null): void
  /** Closes the dialog without mining at all. */
  onCancel(): void
}

export interface BulkMiningViewModel {
  /** Which surface (if any) the current session is shown on. Also reserves
   * right-stack width, so the layout and window sizing read it. */
  presentation: BulkMiningPresentation
  modal: BulkMiningModalProps
  sidebar: BulkMiningSidebarProps
  /** The finished run's one-shot summary toast, until dismissed. */
  completion: BulkMiningCompletionEvent | null
  dismissCompletion(): void
}

export interface VocabularyKnowledgeOptions {
  onSelectMecabDict: DictionariesTabProps['onSelectMecabDict']
  onSaveWanikaniToken: KnowledgeTabProps['onSaveWanikaniToken']
  onChangeKnowledgeSettings: KnowledgeTabProps['onChangeKnowledgeSettings']
  onSyncNow: KnowledgeTabProps['onSyncNow']
}

export interface UseVocabularyMiningResult {
  subtitleOverlay: Pick<
    SubtitleOverlayProps,
    'highlightedTokens' | 'onWordClick' | 'onWordHover' | 'onWordLeave' | 'vocabularySpans'
  >
  subtitleSidebar: Pick<
    SubtitleSidebarProps,
    | 'createTranslationRequestId'
    | 'onCancelTranslation'
    | 'onCopyCue'
    | 'onTranslateCue'
    | 'vocabularySpans'
  >
  wordPopup: Omit<WordPopupProps, 'maxEntries' | 'maxMeanings'>
  cardImageDialog: CardImageDialogViewModel
  vocabularyMenu: VocabularyMenuProps
  report: SubtitleReportProps
  mining: BulkMiningViewModel
  /** The Options rows whose effect is to invalidate or rebuild the caches this
   * feature owns; the rest of the dialog's wiring is not this feature's. */
  knowledgeOptions: VocabularyKnowledgeOptions
  /** True while one of this feature's modals owns keyboard input, so the
   * composition root can suspend the global shortcuts. */
  modalOpen: boolean
}

/**
 * Owns the renderer's vocabulary and mining lifecycle: the per-cue
 * tokenization and knowledge-level caches, word-popup hover/lookup and its
 * Anki mine (including the card-picture flow), the subtitle report, bulk
 * mining and its completion toast, and the all-subtitles panel's copy and
 * translate actions. The returned groups match their UI consumers instead of
 * exposing one flat application-controller contract.
 */
export function useVocabularyMining({
  bridge,
  dispatch,
  player,
  state,
  pausedRef,
  activeCue,
  activeCueKey,
  japaneseSubtitleSelected,
  sidebarOpen,
  optionsData,
  dictionarySettings,
  targetDeckName
}: UseVocabularyMiningInput): UseVocabularyMiningResult {
  // Per-cue tokenization cache + a request-token guard against stale MeCab
  // resolutions. Held in refs so they persist across renders without
  // themselves triggering one.
  const tokenCache = useRef(new Map<string, Token[]>())
  const tokenizeToken = useRef<SubtitleRequestToken>({ current: 0 })
  // Lemma -> resolved knowledge level, warmed across the whole episode (never
  // cleared per cue, unlike tokenCache) plus a request-token guard against a
  // stale resolveKnownLevels resolution, mirroring tokenizeToken above.
  const knownLevelsCache = useRef(new Map<string, KnowledgeLevel>())
  const knownLevelsToken = useRef<SubtitleRequestToken>({ current: 0 })
  // Request-token guards for tokenizeAllCues' batch tokenize + level
  // resolution, separate from tokenizeActiveCue's own tokens above so
  // opening/closing the sidebar never invalidates an in-flight active-cue
  // tokenization (or vice versa) despite sharing tokenCache/knownLevelsCache
  // as the underlying caches.
  const allCuesToken = useRef<SubtitleRequestToken>({ current: 0 })
  const allCuesLevelsToken = useRef<SubtitleRequestToken>({ current: 0 })
  const wholeTrackVocabularyRef = useRef(createWholeTrackVocabularyCoordinator())
  const vocabularySpanEpoch = useRef(0)
  const [vocabularySpansByCue, setVocabularySpansByCue] = useState<
    Record<string, VocabularySpan[]>
  >({})

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
  // A captured frame awaiting the user's crop decision, together with the
  // dictionary entry whose mine triggered it (see handleAddToAnki).
  const [cardImageRequest, setCardImageRequest] = useState<{
    imageBase64: string
    result: LookupResult
  } | null>(null)
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

  // Active-cue tokenization, tokenize-all (sidebar), whole-track vocabulary,
  // and subtitle-report recomputation — see state/useVocabularyPipeline.ts.
  const { prepareWholeTrackVocabulary, vocabularySpans } = useVocabularyPipeline({
    dispatch,
    bridges: {
      mecab: bridge.mecab,
      knowledge: bridge.knowledge,
      dict: bridge.dict
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
    dictionarySettings,
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
    await popupController.open(bridge.dict, bridge.anki, bridge.knowledge, {
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
      bridge.dict,
      term,
      state.popupSettings.frequencyDictId,
      state.popupSettings.sortOrder
    )
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
      bridge.player,
      state.filePath !== undefined
    )
    if (imageBase64) {
      setCardImageRequest({ imageBase64, result })
      return
    }
    await popupController.addToAnki(bridge.anki, result, undefined, mineMediaSource())
  }

  // The crop dialog's outcome: a base64 JPEG mines the card with it, null mines
  // it without a picture. Cancel closes the dialog without mining at all.
  const handleCardImageSubmit = (jpegBase64: string | null): void => {
    const request = cardImageRequest
    setCardImageRequest(null)
    if (!request) return
    void popupController.addToAnki(
      bridge.anki,
      request.result,
      jpegBase64 ? { dataBase64: jpegBase64 } : undefined,
      mineMediaSource()
    )
  }

  // Always call through this stable wrapper (not showWordPopup directly) from
  // the hover debouncer below, so the debounced callback — created once and
  // never recreated — still sees the latest popupSettings/state on every settle.
  const showWordPopupLatest = useLatestCallback(showWordPopup)

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
      mecab: bridge.mecab,
      knowledge: bridge.knowledge,
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

  const handleSyncNow = async (source: KnowledgeSource, force?: boolean): Promise<SyncStatus> => {
    return syncKnowledgeAndRefresh({
      knowledge: bridge.knowledge,
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

  const handleSaveWanikaniToken = async (token: string): Promise<void> => {
    await saveWanikaniToken(bridge.knowledge, optionsData, token)
    if (token === '') {
      // Clearing the token already purged the WaniKani rows main-side — there
      // is nothing to sync, but cached levels must drop immediately.
      await refreshKnownLevels({
        knowledge: bridge.knowledge,
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

  const handleChangeKnowledgeSettings = async (
    patch: Partial<Omit<PublicKnowledgeSettings, 'hasWanikaniToken' | 'encryptionAvailable'>>
  ): Promise<void> => {
    await changeKnowledgeSettings(bridge.knowledge, optionsData, patch)
    if (shouldResyncAnkiForKnowledgePatch(patch)) {
      await handleSyncNow('anki', true)
    }
  }

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
        dict: bridge.dict,
        anki: bridge.anki,
        knowledge: bridge.knowledge
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
      if (event.shouldPause && !pausedRef.current) void player.setPause(true)
      if (event.shouldRefreshKnowledge) void handleSyncNowRef.current('anki', true)
    })
  }, [player, bulkMiningController, handleSyncNowRef, pausedRef])

  const frequencyDictConfigured = state.popupSettings.frequencyDictId !== null
  const translationEnabled = state.translationEnabled

  return {
    subtitleOverlay: {
      vocabularySpans: activeCueKey ? vocabularySpansByCue[activeCueKey] : undefined,
      highlightedTokens: japaneseSubtitleSelected ? wordPopup?.highlightedTokens : undefined,
      onWordHover: japaneseSubtitleSelected ? onWordHover : undefined,
      onWordClick: japaneseSubtitleSelected ? onWordClick : undefined,
      onWordLeave: japaneseSubtitleSelected ? onWordLeave : undefined
    },
    subtitleSidebar: {
      vocabularySpans,
      onCopyCue: (cue) => void copySidebarCue(bridge.clipboard.writeText, cue),
      onTranslateCue: translationEnabled
        ? (cue, requestId) => bridge.translate.translate(cue.text, requestId)
        : undefined,
      createTranslationRequestId: translationEnabled ? () => crypto.randomUUID() : undefined,
      onCancelTranslation: translationEnabled
        ? (requestId) => bridge.translate.cancel(requestId)
        : undefined
    },
    wordPopup: {
      results: wordPopup?.results ?? [],
      position: wordPopup?.position ?? null,
      token: wordPopup?.token,
      sentence: wordPopup?.sentence,
      provenanceByExpression: wordPopup?.provenanceByExpression,
      onClose: closeWordPopup,
      onAddToAnki: handleAddToAnki,
      ankiStatus,
      ankiError,
      ankiExisting,
      duplicatePolicy: popupState.duplicatePolicy,
      onOpenAnkiCard: (cardId) => popupController.openCard(bridge.anki, cardId),
      onLinkClick: handleWordLinkClick,
      // Restores the previous popup payload pushed by handleWordLinkClick.
      onBack: () => popupController.back(),
      canGoBack: popupHistory.length > 0
    },
    cardImageDialog: {
      imageBase64: cardImageRequest?.imageBase64,
      onSubmit: handleCardImageSubmit,
      onCancel: () => setCardImageRequest(null)
    },
    vocabularyMenu: {
      onOpenWordReport: () => setReportOpen(true),
      onOpenBulkMining: () => openMining()
    },
    report: {
      // Bulk mining and the report share the whole-track snapshot; the modal
      // that opens last owns the screen, so the report stays hidden under it.
      open: reportOpen && miningPresentation !== 'modal',
      phase: reportPhase,
      onClose: () => {
        setReportOpen(false)
        reportController.close()
      },
      onRetry: () => {
        void reportController.open({
          bridges: { knowledge: bridge.knowledge },
          snapshot: prepareWholeTrackVocabulary
        })
      }
    },
    mining: {
      presentation: miningPresentation,
      modal: {
        phase: bulkMiningPhase,
        available: japaneseSubtitleSelected && state.cues.length > 0,
        frequencyDictConfigured,
        targetDeckName,
        onClose: closeMining,
        onHideToSidebar: () =>
          setMiningPresentation(hideBulkMiningToSidebar(miningPresentation, bulkMiningPhase)),
        onThresholdChange: (raw) => bulkMiningController.setThreshold(raw),
        onMinimumCountChange: (raw) => bulkMiningController.setMinimumCount(raw),
        onSortChange: (sort) => bulkMiningController.setSort(sort, frequencyDictConfigured),
        onToggle: (lemma) => bulkMiningController.toggle(lemma),
        onSelectAll: () => bulkMiningController.selectAllVisible(frequencyDictConfigured),
        onSelectNone: () => bulkMiningController.selectNoneVisible(frequencyDictConfigured),
        onSetHideTargetDeckMatches: (hide) => bulkMiningController.setHideTargetDeckMatches(hide),
        onStart: () =>
          void bulkMiningController.start(
            { dict: bridge.dict, anki: bridge.anki },
            mineMediaSource()
          ),
        onCancel: () => bulkMiningController.cancel(),
        onBackToList: () =>
          void bulkMiningController.backToList({
            dict: bridge.dict,
            anki: bridge.anki,
            knowledge: bridge.knowledge
          }),
        onRetry: () => {
          void bulkMiningController.open({
            bridges: {
              dict: bridge.dict,
              anki: bridge.anki,
              knowledge: bridge.knowledge
            },
            snapshot: prepareWholeTrackVocabulary,
            cues: state.cues,
            frequencyDictId: state.popupSettings.frequencyDictId,
            sortOrder: state.popupSettings.sortOrder
          })
        }
      },
      sidebar: {
        phase: bulkMiningPhase,
        onReopen: () => setMiningPresentation(reopenBulkMiningModal(miningPresentation)),
        onCancel: () => bulkMiningController.cancel()
      },
      completion: miningCompletion,
      dismissCompletion: () => setMiningCompletion(null)
    },
    knowledgeOptions: {
      onSelectMecabDict: handleSelectMecabDict,
      onSaveWanikaniToken: handleSaveWanikaniToken,
      onChangeKnowledgeSettings: handleChangeKnowledgeSettings,
      onSyncNow: handleSyncNow
    },
    modalOpen: reportOpen || cardImageRequest !== null || miningPresentation === 'modal'
  }
}
