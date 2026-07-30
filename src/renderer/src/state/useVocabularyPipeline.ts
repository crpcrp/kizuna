import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch as ReactDispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import type { Cue } from '../../../shared/cue'
import type { Token } from '../../../shared/token'
import type { KnowledgeDetails, KnowledgeLevel, SyncStatus } from '../../../shared/knowledge'
import type { PopupSortOrder } from '../../../shared/playerSettings'
import { type Dispatch, type SubtitleRequestToken } from './mediaSession'
import {
  type KnowledgeBridge,
  type MecabBatchBridge,
  type MecabBridge,
  cueKey,
  resolveKnownLevels,
  tokenizeActiveCue,
  tokenizeAllCues
} from './tokenization'
import { type DictLookupBridge } from './wordLookup'
import type {
  WholeTrackVocabularyCoordinator,
  WholeTrackVocabularyResult
} from './wholeTrackVocabulary'
import { wholeTrackVocabularyDependencyKey } from './wholeTrackVocabularyKey'
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
  tokenCacheRef: RefObject<Map<string, Token[]>>
  tokenizeTokenRef: RefObject<SubtitleRequestToken>
  knownLevelsCacheRef: RefObject<Map<string, KnowledgeLevel>>
  knownLevelsTokenRef: RefObject<SubtitleRequestToken>
  allCuesTokenRef: RefObject<SubtitleRequestToken>
  allCuesLevelsTokenRef: RefObject<SubtitleRequestToken>
  wholeTrackVocabularyRef: RefObject<WholeTrackVocabularyCoordinator>
  vocabularySpanEpochRef: RefObject<number>
  vocabularySpansByCue: Record<string, VocabularySpan[]>
  setVocabularySpansByCue: ReactDispatch<SetStateAction<Record<string, VocabularySpan[]>>>
  reportController: SubtitleReportController
}

export interface UseVocabularyPipelineResult {
  /** Prepares (or reuses) the current whole-track vocabulary snapshot — shared by
   * bulk mining, the F1 subtitle report, and their retry actions. */
  prepareWholeTrackVocabulary: () => Promise<WholeTrackVocabularyResult>
  /** Every accepted vocabulary span across all cues, flattened for the sidebar. */
  vocabularySpans: VocabularySpan[]
}

/**
 * Owns the active-cue tokenization, tokenize-all (sidebar), whole-track
 * vocabulary, and F1 subtitle-report recomputation cluster. See
 * `docs/codebase-map.md` for the invariants this preserves.
 */
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
  tokenCacheRef,
  tokenizeTokenRef,
  knownLevelsCacheRef,
  knownLevelsTokenRef,
  allCuesTokenRef,
  allCuesLevelsTokenRef,
  wholeTrackVocabularyRef,
  vocabularySpanEpochRef,
  vocabularySpansByCue,
  setVocabularySpansByCue,
  reportController
}: UseVocabularyPipelineInput): UseVocabularyPipelineResult {
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
    tokenizeTokenRef.current.current++
    knownLevelsTokenRef.current.current++
    allCuesTokenRef.current.current++
    allCuesLevelsTokenRef.current.current++
    dispatch({ type: 'resetTokenization' })
  }, [
    japaneseSubtitleSelected,
    dispatch,
    tokenizeTokenRef,
    knownLevelsTokenRef,
    allCuesTokenRef,
    allCuesLevelsTokenRef
  ])

  // Lazily (re)tokenizes the active cue via MeCab — only when the active cue
  // identity actually changes (activeCueKey in the dep array), never on
  // every timePos tick. tokenizeActiveCue itself caches by cue key, so
  // scrubbing back to an already-tokenized cue is a synchronous dispatch.
  // Chained after it, resolveKnownLevels resolves each token's knowledge
  // level (for SubtitleOverlay's coloring, added in a later slice) — it
  // needs tokenizeActiveCue's resolved token list, not state.activeTokens,
  // since that dispatch hasn't landed yet within this same effect tick.
  useEffect(() => {
    if (!japaneseSubtitleSelected) return
    tokenizeActiveCue(
      bridges.mecab,
      dispatch,
      activeCue,
      tokenCacheRef.current,
      tokenizeTokenRef.current
    ).then((tokens) =>
      resolveKnownLevels(
        bridges.knowledge,
        dispatch,
        tokens,
        knownLevelsCacheRef.current,
        knownLevelsTokenRef.current
      )
    )
    // activeCue is listed for the linter but never re-fires this on its own:
    // it is the cue object activeCueKey identifies, so it only changes identity
    // when that key does (or when the whole cue list is replaced).
  }, [
    activeCueKey,
    japaneseSubtitleSelected,
    activeCue,
    bridges.mecab,
    bridges.knowledge,
    dispatch,
    tokenCacheRef,
    tokenizeTokenRef,
    knownLevelsCacheRef,
    knownLevelsTokenRef
  ])

  // Lazily tokenizes every cue of the current track (for SubtitleSidebar's
  // per-word coloring) once the sidebar is open — never while it's closed, so
  // a viewer who never opens it pays no extra MeCab/knowledge cost. Reuses
  // tokenCache/knownLevelsCache (shared with tokenizeActiveCue above), so
  // cues already tokenized while playing aren't re-sent to MeCab. Re-runs
  // when state.cues changes identity (new track loaded), since cuesLoaded
  // resets allCueTokens to {}.
  useEffect(() => {
    if (!japaneseSubtitleSelected || !sidebarOpen || cues.length === 0) return
    tokenizeAllCues(
      bridges.mecab,
      bridges.knowledge,
      dispatch,
      cues,
      tokenCacheRef.current,
      knownLevelsCacheRef.current,
      allCuesTokenRef.current,
      allCuesLevelsTokenRef.current
    )
  }, [
    sidebarOpen,
    cues,
    japaneseSubtitleSelected,
    bridges.mecab,
    bridges.knowledge,
    dispatch,
    tokenCacheRef,
    knownLevelsCacheRef,
    allCuesTokenRef,
    allCuesLevelsTokenRef
  ])

  useEffect(() => {
    wholeTrackVocabularyRef.current.invalidate()
    vocabularySpanEpochRef.current++
    setVocabularySpansByCue({})
  }, [
    wholeTrackVocabularyKey,
    wholeTrackVocabularyRef,
    vocabularySpanEpochRef,
    setVocabularySpansByCue
  ])

  const prepareWholeTrackVocabulary = useCallback(() => {
    if (!japaneseSubtitleSelected || cues.length === 0)
      return Promise.resolve({ kind: 'stale' } as const)
    const epoch = vocabularySpanEpochRef.current
    return wholeTrackVocabularyRef.current.prepare({
      mecab: bridges.mecab,
      dict: bridges.dict,
      knowledge: bridges.knowledge,
      dispatch,
      cues,
      tokenCache: tokenCacheRef.current,
      knownLevelsCache: knownLevelsCacheRef.current,
      allCuesToken: allCuesTokenRef.current,
      allCuesLevelsToken: allCuesLevelsTokenRef.current,
      frequencyDictId,
      sortOrder,
      epoch: { file: epoch, track: epoch, tokenization: epoch, dictionary: epoch, knowledge: epoch }
    })
    // wholeTrackVocabularyKey is listed although the body never reads it: the
    // effect above invalidates the coordinator (and bumps the span epoch) when
    // that key changes, and this callback must take a new identity at the same
    // moment so its consumers — the span effect and the F1 report effect below
    // — re-run against the invalidated snapshot instead of the stale one.
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
    tokenCacheRef,
    knownLevelsCacheRef,
    allCuesTokenRef,
    allCuesLevelsTokenRef,
    wholeTrackVocabularyRef,
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

  // (Re)computes the F1 subtitle report while its modal is open, sharing
  // tokenCache/knownLevelsCache/allCuesToken with the sidebar effect above
  // (see tokenizeAllCues). Keyed on state.cues and the Japanese-track flag
  // so switching files or subtitle tracks while the modal is open
  // recomputes automatically; the controller's own request token makes the
  // latest call win over a stale in-flight one.
  useEffect(() => {
    if (!reportOpen) return
    void reportController.open({
      bridges: { knowledge: bridges.knowledge },
      snapshot: prepareWholeTrackVocabulary
    })
  }, [reportOpen, prepareWholeTrackVocabulary, bridges.knowledge, reportController])

  const vocabularySpans = useMemo(
    () => Object.values(vocabularySpansByCue).flat(),
    [vocabularySpansByCue]
  )

  return { prepareWholeTrackVocabulary, vocabularySpans }
}
