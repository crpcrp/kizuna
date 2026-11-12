import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Cue } from '../../../shared/cue'
import type { Token } from '../../../shared/token'
import type { KnowledgeDetails, SyncStatus } from '../../../shared/knowledge'
import type { PopupSortOrder } from '../../../shared/playerSettings'
import { type Dispatch } from './mediaSession'
import {
  createVocabularyCaches,
  type VocabularyCaches,
  type KnowledgeBridge,
  type MecabBatchBridge,
  type MecabBridge,
  cueKey,
  resolveKnownLevels,
  tokenizeActiveCue,
  tokenizeAllCues
} from './tokenization'
import { type DictLookupBridge } from './wordLookup'
import type { WholeTrackVocabularyResult } from './wholeTrackVocabulary'
import {
  createWholeTrackVocabularyCoordinator,
  wholeTrackVocabularyDependencyKey
} from './wholeTrackVocabulary'
import type { VocabularySpan } from './vocabularySpans'
import type { SubtitleReportController } from './subtitleReportController'

/** Combined preload surface the vocabulary pipeline needs: MeCab (single + batch
 * tokenize), knowledge (levels, details, sync status) and Yomitan/dictionary lookup. */
export interface VocabularyPipelineBridges {
  mecab: MecabBridge & MecabBatchBridge
  knowledge: KnowledgeBridge & {
    detailsFor(expressions: string[]): Promise<Record<string, KnowledgeDetails>>
    syncStatus(): Promise<SyncStatus>
  }
  dict: DictLookupBridge
}

export interface UseVocabularyPipelineInput {
  dispatch: Dispatch
  bridges: VocabularyPipelineBridges
  cues: Cue[]
  activeCue: Cue | undefined
  activeCueKey: string | undefined
  allCueTokens: Record<string, Token[]>
  activeTokens: Token[]
  japaneseSubtitleSelected: boolean
  sidebarOpen: boolean
  reportOpen: boolean
  filePath: string | undefined
  selectedSubtitleId: number | null
  frequencyDictId: number | null
  sortOrder: PopupSortOrder
  dictionarySettings: unknown
  knowledgeEpoch: number
  reportController: SubtitleReportController
}

export interface UseVocabularyPipelineResult {
  /** Prepares (or reuses) the current whole-track vocabulary snapshot — shared by
   * bulk mining, the subtitle report, and their retry actions. */
  prepareWholeTrackVocabulary: () => Promise<WholeTrackVocabularyResult>
  spansForCue(cueKey: string | undefined): VocabularySpan[] | undefined
  refs: RefObject<VocabularyCaches>
  invalidateVocabularySpans(): void
}

export function useVocabularyPipeline({
  dispatch,
  bridges,
  cues,
  activeCue,
  activeCueKey,
  allCueTokens,
  activeTokens,
  japaneseSubtitleSelected,
  sidebarOpen,
  reportOpen,
  filePath,
  selectedSubtitleId,
  frequencyDictId,
  sortOrder,
  dictionarySettings,
  knowledgeEpoch,
  reportController
}: UseVocabularyPipelineInput): UseVocabularyPipelineResult {
  const refs = useRef(createVocabularyCaches())
  const wholeTrackVocabulary = useRef(createWholeTrackVocabularyCoordinator())
  const vocabularySpanEpochRef = useRef(0)
  const [vocabularySpansByCue, setVocabularySpansByCue] = useState<
    Record<string, VocabularySpan[]>
  >({})
  const invalidateVocabularySpans = useCallback((): void => {
    wholeTrackVocabulary.current.invalidate()
    vocabularySpanEpochRef.current++
    setVocabularySpansByCue({})
  }, [wholeTrackVocabulary])
  const spansForCue = useCallback(
    (key: string | undefined) => (key ? vocabularySpansByCue[key] : undefined),
    [vocabularySpansByCue]
  )

  const tokenizedSpanCues = useMemo(
    () =>
      cues.flatMap((cue) => {
        const key = cueKey(cue)
        const tokens = allCueTokens[key] ?? (key === activeCueKey ? activeTokens : undefined)
        return tokens ? [{ cueKey: key, tokens }] : []
      }),
    [cues, allCueTokens, activeCueKey, activeTokens]
  )
  const wholeTrackVocabularyKey = useMemo(
    () =>
      wholeTrackVocabularyDependencyKey({
        filePath: filePath ?? null,
        subtitleTrackId: selectedSubtitleId,
        japaneseSubtitleSelected,
        cues,
        frequencyDictId,
        sortOrder,
        dictionarySettings,
        knowledgeEpoch
      }),
    [
      filePath,
      selectedSubtitleId,
      japaneseSubtitleSelected,
      cues,
      frequencyDictId,
      sortOrder,
      dictionarySettings,
      knowledgeEpoch
    ]
  )

  // Non-Japanese tracks still render their extracted cue text, but never use
  // Japanese morphology or word knowledge. Bump every in-flight request guard
  // so a late Japanese result cannot repaint the newly selected plain-text track.
  useEffect(() => {
    if (japaneseSubtitleSelected) return
    refs.current.tokens.active.current++
    refs.current.tokens.levels.current++
    refs.current.tokens.allCues.current++
    refs.current.tokens.allCuesLevels.current++
    dispatch({ type: 'resetTokenization' })
  }, [japaneseSubtitleSelected, dispatch, refs])

  // Tokenize only when the active cue changes, then resolve its knowledge levels.
  useEffect(() => {
    if (!japaneseSubtitleSelected) return
    tokenizeActiveCue(
      bridges.mecab,
      dispatch,
      activeCue,
      refs.current.tokenCache,
      refs.current.tokens.active
    ).then((tokens) =>
      resolveKnownLevels(
        bridges.knowledge,
        dispatch,
        tokens,
        refs.current.knownLevelsCache,
        refs.current.tokens.levels
      )
    )
  }, [
    activeCueKey,
    japaneseSubtitleSelected,
    activeCue,
    bridges.mecab,
    bridges.knowledge,
    dispatch,
    refs
  ])

  // The sidebar warms the same caches without cancelling active-cue work.
  useEffect(() => {
    if (!japaneseSubtitleSelected || !sidebarOpen || cues.length === 0) return
    tokenizeAllCues(
      bridges.mecab,
      bridges.knowledge,
      dispatch,
      cues,
      refs.current.tokenCache,
      refs.current.knownLevelsCache,
      refs.current.tokens.allCues,
      refs.current.tokens.allCuesLevels
    )
  }, [
    sidebarOpen,
    cues,
    japaneseSubtitleSelected,
    bridges.mecab,
    bridges.knowledge,
    dispatch,
    refs
  ])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset projections when the external track/dictionary identity changes.
  useEffect(invalidateVocabularySpans, [wholeTrackVocabularyKey, invalidateVocabularySpans])

  const prepareWholeTrackVocabulary = useCallback(() => {
    if (!japaneseSubtitleSelected || cues.length === 0)
      return Promise.resolve({ kind: 'stale' } as const)
    const epoch = vocabularySpanEpochRef.current
    return wholeTrackVocabulary.current.prepare({
      mecab: bridges.mecab,
      dict: bridges.dict,
      knowledge: bridges.knowledge,
      dispatch,
      cues,
      tokenCache: refs.current.tokenCache,
      knownLevelsCache: refs.current.knownLevelsCache,
      allCuesToken: refs.current.tokens.allCues,
      allCuesLevelsToken: refs.current.tokens.allCuesLevels,
      frequencyDictId,
      sortOrder,
      epoch: { file: epoch, track: epoch, tokenization: epoch, dictionary: epoch, knowledge: epoch }
    })
    // wholeTrackVocabularyKey is listed although the body never reads it: the
    // effect above invalidates the coordinator (and bumps the span epoch) when
    // that key changes, and this callback must take a new identity at the same
    // moment so its consumers — the span effect and the subtitle-report effect
    // below — re-run against the invalidated snapshot instead of the stale one.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above.
  }, [
    dispatch,
    japaneseSubtitleSelected,
    cues,
    frequencyDictId,
    sortOrder,
    wholeTrackVocabularyKey,
    bridges.mecab,
    bridges.dict,
    bridges.knowledge,
    refs,
    wholeTrackVocabulary,
    vocabularySpanEpochRef
  ])

  useEffect(() => {
    if (!japaneseSubtitleSelected || tokenizedSpanCues.length === 0) return
    void prepareWholeTrackVocabulary().then((result) => {
      if (result.kind === 'ready')
        setVocabularySpansByCue((current) => ({ ...current, ...result.snapshot.spansByCue }))
    })
  }, [
    japaneseSubtitleSelected,
    tokenizedSpanCues,
    prepareWholeTrackVocabulary,
    setVocabularySpansByCue
  ])

  useEffect(() => {
    if (!reportOpen) return
    void reportController.open({
      bridges: { knowledge: bridges.knowledge },
      snapshot: prepareWholeTrackVocabulary
    })
  }, [reportOpen, prepareWholeTrackVocabulary, bridges.knowledge, reportController])

  return { prepareWholeTrackVocabulary, spansForCue, refs, invalidateVocabularySpans }
}
