import type { Dispatch, RefObject } from 'react'
import type { Cue } from '../../../shared/cue'
import type { KnowledgeSource, SyncStatus } from '../../../shared/knowledge'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { PlayerApi } from '../components/BottomBar'
import type { VocabularyMenuProps } from '../components/menu/VocabularyMenu'
import type { SubtitleOverlayProps } from '../components/SubtitleOverlay'
import type { SubtitleReportProps } from '../components/SubtitleReport'
import type { SubtitleSidebarProps } from '../components/SubtitleSidebar'
import type { WordPopupProps } from '../components/WordPopup'
import type { MineMediaSource } from './ankiMining'
import type { OptionsDataController } from './optionsData'
import type { PlayerAction, PlayerState } from './playerState'
import { useBulkMining, type BulkMiningViewModel } from './useBulkMining'
import { useKnowledgeOptions, type VocabularyKnowledgeOptions } from './useKnowledgeOptions'
import { useLatestCallback } from './useLatestRef'
import { useSubtitleReport } from './useSubtitleReport'
import { useVocabularyPipeline } from './useVocabularyPipeline'
import { useWordPopup, type CardImageDialogViewModel } from './useWordPopup'
import type { WholeTrackVocabularyResult } from './wholeTrackVocabulary'

export type { BulkMiningViewModel } from './useBulkMining'
export type { VocabularyKnowledgeOptions } from './useKnowledgeOptions'
export type { CardImageDialogViewModel } from './useWordPopup'

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
  activeCue: Cue | undefined
  activeCueKey: string | undefined
  /** False for a non-Japanese (or no) subtitle track: every workflow here is
   * disabled, and the whole-track session is invalidated. */
  japaneseSubtitleSelected: boolean
  /** Whether the all-subtitles panel is open — it is the only consumer of the
   * whole-track tokenization, so it gates that work. */
  sidebarOpen: boolean
  optionsData: OptionsDataController
  /** Cached dictionary settings; part of the whole-track vocabulary key, since
   * enabling or reordering a dictionary changes the resolved entries. */
  dictionarySettings: unknown
  targetDeckName: string | undefined
}

export interface UseVocabularyMiningResult {
  autoPause: {
    prepareCueEligibility: () => Promise<WholeTrackVocabularyResult>
  }
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
    | 'spansForCue'
  >
  wordPopup: Omit<WordPopupProps, 'maxEntries' | 'maxMeanings'>
  cardImageDialog: CardImageDialogViewModel
  vocabularyMenu: VocabularyMenuProps
  report: SubtitleReportProps
  mining: BulkMiningViewModel
  knowledgeOptions: VocabularyKnowledgeOptions
  syncNow(source: KnowledgeSource, force?: boolean): Promise<SyncStatus>
  modalOpen: boolean
}

// Declare the report before the pipeline because it gates whole-track work; retry takes a fresh cache snapshot.
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
  // Keep media context identity stable because popup and bulk mining callbacks retain it.
  const mineMediaSource = useLatestCallback((): MineMediaSource => ({
    filePath: state.filePath,
    audioStreamIndex: state.selectedAudioId,
    subtitleOffsetMs: state.subtitleOffsetMs
  }))

  const report = useSubtitleReport({ bridge })

  const caches = useVocabularyPipeline({
    dispatch,
    bridges: bridge,
    cues: state.cues,
    activeCue,
    activeCueKey,
    allCueTokens: state.allCueTokens,
    activeTokens: state.activeTokens,
    japaneseSubtitleSelected,
    sidebarOpen,
    reportOpen: report.open,
    filePath: state.filePath,
    selectedSubtitleId: state.selectedSubtitleId,
    frequencyDictId: state.popupSettings.frequencyDictId,
    sortOrder: state.popupSettings.sortOrder,
    dictionarySettings,
    knowledgeEpoch: state.knowledgeEpoch,
    reportController: report.controller
  })

  const popup = useWordPopup({
    bridge,
    popupSettings: {
      frequencyDictId: state.popupSettings.frequencyDictId,
      sortOrder: state.popupSettings.sortOrder
    },
    activeTokens: state.activeTokens,
    activeCue,
    japaneseSubtitleSelected,
    videoLoaded: state.filePath !== undefined,
    mineMediaSource
  })

  const knowledge = useKnowledgeOptions({
    bridge,
    dispatch,
    optionsData,
    activeCue,
    cues: state.cues,
    sidebarOpen,
    activeTokens: state.activeTokens,
    allCueTokens: state.allCueTokens,
    caches
  })

  const { open: openMining, ...mining } = useBulkMining({
    bridge,
    player,
    pausedRef,
    cues: state.cues,
    frequencyDictId: state.popupSettings.frequencyDictId,
    sortOrder: state.popupSettings.sortOrder,
    japaneseSubtitleSelected,
    targetDeckName,
    snapshot: caches.prepareWholeTrackVocabulary,
    syncNow: knowledge.syncNow,
    closeReport: report.close,
    mineMediaSource
  })

  const translationEnabled = state.translationEnabled

  return {
    autoPause: {
      prepareCueEligibility: caches.prepareWholeTrackVocabulary
    },
    subtitleOverlay: {
      vocabularySpans: caches.spansForCue(activeCueKey),
      ...popup.handlers
    },
    subtitleSidebar: {
      spansForCue: caches.spansForCue,
      onCopyCue: (cue) => void bridge.clipboard.writeText(cue.text),
      onTranslateCue: translationEnabled
        ? (cue, requestId) => bridge.translate.translate(cue.text, requestId)
        : undefined,
      createTranslationRequestId: translationEnabled ? () => crypto.randomUUID() : undefined,
      onCancelTranslation: translationEnabled
        ? (requestId) => bridge.translate.cancel(requestId)
        : undefined
    },
    wordPopup: popup.props,
    cardImageDialog: popup.cardImageDialog,
    vocabularyMenu: {
      onOpenWordReport: () => report.requestOpen(),
      onOpenBulkMining: () => openMining()
    },
    report: {
      // Bulk mining and the report share the whole-track snapshot; the modal
      // that opens last owns the screen, so the report stays hidden under it.
      open: report.open && mining.presentation !== 'modal',
      phase: report.phase,
      onClose: () => report.close(),
      onRetry: () => report.retry(caches.prepareWholeTrackVocabulary)
    },
    mining,
    knowledgeOptions: knowledge.options,
    syncNow: knowledge.syncNow,
    modalOpen: report.open || popup.cardImageOpen || mining.presentation === 'modal'
  }
}
