import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import type { Cue } from '../../../shared/cue'
import type { KnowledgeSource, SyncStatus } from '../../../shared/knowledge'
import type { PopupSortOrder } from '../../../shared/playerSettings'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { PlayerApi } from '../components/BottomBar'
import type { BulkMiningModalProps } from '../components/BulkMiningModal'
import type { BulkMiningSidebarProps } from '../components/BulkMiningSidebar'
import type { MineMediaSource } from './ankiMining'
import {
  createBulkMiningCompletionTracker,
  type BulkMiningCompletionEvent
} from './bulkMiningCompletion'
import { createBulkMiningController } from './bulkMiningController'
import {
  hideBulkMiningToSidebar,
  reopenBulkMiningModal,
  type BulkMiningPresentation
} from './bulkMiningPresentation'
import { useLatestCallback, useLatestRef } from './useLatestRef'
import type { WholeTrackVocabularyResult } from './wholeTrackVocabulary'

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

export interface UseBulkMiningInput {
  /** Dictionary resolution, Anki mining and duplicate checks, knowledge levels. */
  bridge: Pick<KizunaApi, 'dict' | 'anki' | 'knowledge'>
  player: Pick<PlayerApi, 'setPause'>
  /** Latest pause flag, so a finished mine only pauses playback that is running. */
  pausedRef: RefObject<boolean>
  cues: Cue[]
  frequencyDictId: number | null
  sortOrder: PopupSortOrder
  japaneseSubtitleSelected: boolean
  /** Anki's configured target deck, shown in the duplicate filter. */
  targetDeckName: string | undefined
  /** Prepares (or reuses) the whole-track vocabulary a session mines from. */
  snapshot(): Promise<WholeTrackVocabularyResult>
  /** Re-syncs knowledge after a run that added cards. */
  syncNow(source: KnowledgeSource, force?: boolean): Promise<SyncStatus>
  /** Opening a session closes the report — both its flag and its controller. */
  closeReport(): void
  /** Where a mined line's audio could be clipped from. */
  mineMediaSource(): MineMediaSource
}

export interface UseBulkMiningResult extends BulkMiningViewModel {
  /** Opens the modal, or restores it from the compact sidebar. */
  open(): void
}

/**
 * Owns a bulk-mining session: its controller, which surface it is shown on,
 * the file/track switch that invalidates it, and the completion toast (plus
 * the pause and knowledge re-sync a finished run triggers).
 */
export function useBulkMining({
  bridge,
  player,
  pausedRef,
  cues,
  frequencyDictId,
  sortOrder,
  japaneseSubtitleSelected,
  targetDeckName,
  snapshot,
  syncNow,
  closeReport,
  mineMediaSource
}: UseBulkMiningInput): UseBulkMiningResult {
  const [bulkMiningController] = useState(createBulkMiningController)
  const bulkMiningPhase = useSyncExternalStore(
    bulkMiningController.subscribe,
    () => bulkMiningController.getState(),
    () => bulkMiningController.getState()
  )
  const [miningPresentation, setMiningPresentation] = useState<BulkMiningPresentation>('closed')
  const miningCompletionTrackerRef = useRef(createBulkMiningCompletionTracker())
  const [miningCompletion, setMiningCompletion] = useState<BulkMiningCompletionEvent | null>(null)
  const syncNowRef = useLatestRef(syncNow)

  const closeMining = useLatestCallback((): void => {
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
    closeReport()
    setMiningPresentation('modal')
    void bulkMiningController.open({
      bridges: {
        dict: bridge.dict,
        anki: bridge.anki,
        knowledge: bridge.knowledge
      },
      snapshot,
      cues,
      frequencyDictId,
      sortOrder
    })
  }

  // A file or subtitle-track switch invalidates the mining session, including
  // one currently hidden in the compact sidebar. Run as the cleanup of the
  // outgoing cue list/track so the teardown fires on exactly the same
  // transitions, without the effect body itself writing state.
  const invalidateMiningRef = useLatestRef((): void => {
    if (miningPresentation !== 'closed') closeMining()
  })
  useEffect(
    () => () => invalidateMiningRef.current(),
    [cues, japaneseSubtitleSelected, invalidateMiningRef]
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
      if (event.shouldRefreshKnowledge) void syncNowRef.current('anki', true)
    })
  }, [player, bulkMiningController, syncNowRef, pausedRef])

  const frequencyDictConfigured = frequencyDictId !== null

  return {
    presentation: miningPresentation,
    modal: {
      phase: bulkMiningPhase,
      available: japaneseSubtitleSelected && cues.length > 0,
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
          snapshot,
          cues,
          frequencyDictId,
          sortOrder
        })
      }
    },
    sidebar: {
      phase: bulkMiningPhase,
      onReopen: () => setMiningPresentation(reopenBulkMiningModal(miningPresentation)),
      onCancel: () => bulkMiningController.cancel()
    },
    completion: miningCompletion,
    dismissCompletion: () => setMiningCompletion(null),
    open: openMining
  }
}
