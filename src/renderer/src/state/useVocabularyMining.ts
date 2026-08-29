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
import { copySidebarCue } from './appChrome'
import type { OptionsDataController } from './optionsData'
import type { PlayerAction, PlayerState } from './playerState'
import { useBulkMining, type BulkMiningViewModel } from './useBulkMining'
import { useKnowledgeOptions, type VocabularyKnowledgeOptions } from './useKnowledgeOptions'
import { useLatestCallback } from './useLatestRef'
import { useSubtitleReport } from './useSubtitleReport'
import { useVocabularyCaches } from './useVocabularyCaches'
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
  /** Rebuilds local knowledge after a bulk export changes Anki. */
  syncNow(source: KnowledgeSource, force?: boolean): Promise<SyncStatus>
  /** True while one of this feature's modals owns keyboard input, so the
   * composition root can suspend the global shortcuts. */
  modalOpen: boolean
}

/**
 * Composes the renderer's vocabulary and mining lifecycle from the five hooks
 * that own its parts — `useSubtitleReport`, `useVocabularyCaches`,
 * `useWordPopup`, `useKnowledgeOptions` and `useBulkMining` — plus the two
 * pieces that belong to none of them: the mined-line media source both mining
 * paths share, and the all-subtitles panel's copy and translate actions. The
 * returned groups match their UI consumers instead of exposing one flat
 * application-controller contract.
 *
 * The declaration order below is load-bearing. The report owns the flag that
 * gates whole-track work, so it is declared first; the caches produce the
 * snapshot the report's retry recomputes from, which is why `retry` takes that
 * snapshot as an argument instead of capturing it.
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
  // Where a mined line's audio could be clipped from. `mineMediaContext`
  // rejects an unsupported source, a missing audio selection, and unusable cue timing,
  // so this can be passed unconditionally. Stable identity, since both the
  // popup's mine and bulk mining's onStart hold on to it.
  const mineMediaSource = useLatestCallback((): MineMediaSource => ({
    filePath: state.filePath,
    audioStreamIndex: state.selectedAudioId,
    subtitleOffsetMs: state.subtitleOffsetMs
  }))

  const report = useSubtitleReport({ bridge })

  const caches = useVocabularyCaches({
    dispatch,
    bridge,
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
      vocabularySpans: caches.vocabularySpans,
      onCopyCue: (cue) => void copySidebarCue(bridge.clipboard.writeText, cue),
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
