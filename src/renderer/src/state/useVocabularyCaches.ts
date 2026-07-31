import { useCallback, useRef, useState, type Dispatch, type RefObject } from 'react'
import type { Cue } from '../../../shared/cue'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import type { PopupSortOrder } from '../../../shared/playerSettings'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { Token } from '../../../shared/token'
import type { SubtitleRequestToken } from './mediaSession'
import type { PlayerAction } from './playerState'
import type { SubtitleReportController } from './subtitleReportController'
import { useVocabularyPipeline } from './useVocabularyPipeline'
import type { VocabularySpan } from './vocabularySpans'
import {
  createWholeTrackVocabularyCoordinator,
  type WholeTrackVocabularyResult
} from './wholeTrackVocabulary'

/**
 * The caches and request-token guards the vocabulary pipeline reads, bundled
 * for the Options actions that have to invalidate them by hand.
 *
 * `allCuesToken`/`allCuesLevelsToken` are deliberately separate from
 * `tokenizeToken`/`knownLevelsToken` even though both pairs guard work over the
 * same `tokenCache`/`knownLevelsCache`: opening or closing the sidebar must
 * never invalidate an in-flight active-cue tokenization, or vice versa.
 */
export interface VocabularyCacheRefs {
  /** Per-cue tokenization cache, cleared when a dictionary switch invalidates it. */
  tokenCache: RefObject<Map<string, Token[]>>
  /** Request-token guard for the active cue's tokenization. */
  tokenizeToken: RefObject<SubtitleRequestToken>
  /** Lemma -> knowledge level, warmed across the whole episode and never
   * cleared per cue, unlike `tokenCache`. */
  knownLevelsCache: RefObject<Map<string, KnowledgeLevel>>
  /** Request-token guard for the active cue's level resolution. */
  knownLevelsToken: RefObject<SubtitleRequestToken>
  /** Request-token guard for the sidebar's batch tokenization. */
  allCuesToken: RefObject<SubtitleRequestToken>
  /** Request-token guard for the sidebar's batch level resolution. */
  allCuesLevelsToken: RefObject<SubtitleRequestToken>
}

export interface UseVocabularyCachesInput {
  dispatch: Dispatch<PlayerAction>
  /** MeCab (single + batch tokenize), knowledge levels, and dictionary lookup. */
  bridge: Pick<KizunaApi, 'mecab' | 'knowledge' | 'dict'>
  cues: Cue[]
  activeCue: Cue | undefined
  activeCueKey: string | undefined
  allCueTokens: Record<string, Token[]>
  activeTokens: Token[]
  japaneseSubtitleSelected: boolean
  sidebarOpen: boolean
  /** The report's raw open flag — it gates whole-track recomputation. */
  reportOpen: boolean
  filePath: string | undefined
  selectedSubtitleId: number | null
  frequencyDictId: number | null
  sortOrder: PopupSortOrder
  dictionarySettings: unknown
  knowledgeEpoch: number
  /** Owned by `useSubtitleReport`; the pipeline writes report recomputation
   * through it while the modal is open. */
  reportController: SubtitleReportController
}

export interface UseVocabularyCachesResult {
  /** Prepares (or reuses) the current whole-track vocabulary snapshot — shared
   * by the subtitle report and bulk mining. */
  prepareWholeTrackVocabulary: () => Promise<WholeTrackVocabularyResult>
  /** Every accepted vocabulary span across all cues, flattened for the sidebar. */
  vocabularySpans: VocabularySpan[]
  /** The spans of one cue, for the overlay. */
  spansForCue(cueKey: string | undefined): VocabularySpan[] | undefined
  refs: VocabularyCacheRefs
  /** Drops the whole-track snapshot and every computed span, for an Options
   * change the pipeline's own dependency key cannot see. */
  invalidateVocabularySpans(): void
}

/**
 * Owns the renderer's vocabulary caches: the per-cue tokenization and
 * knowledge-level maps, their request-token guards, the whole-track
 * coordinator, and the computed vocabulary spans. Drives them through
 * `state/useVocabularyPipeline.ts` and is the only owner of that pipeline's
 * refs — everything else reaches them through `refs` or
 * `invalidateVocabularySpans`.
 */
export function useVocabularyCaches({
  dispatch,
  bridge,
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
}: UseVocabularyCachesInput): UseVocabularyCachesResult {
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

  // Active-cue tokenization, tokenize-all (sidebar), whole-track vocabulary,
  // and subtitle-report recomputation — see state/useVocabularyPipeline.ts.
  const { prepareWholeTrackVocabulary, vocabularySpans } = useVocabularyPipeline({
    dispatch,
    bridges: {
      mecab: bridge.mecab,
      knowledge: bridge.knowledge,
      dict: bridge.dict
    },
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

  const invalidateVocabularySpans = useCallback((): void => {
    wholeTrackVocabularyRef.current.invalidate()
    vocabularySpanEpoch.current++
    setVocabularySpansByCue({})
  }, [])

  const spansForCue = useCallback(
    (key: string | undefined): VocabularySpan[] | undefined =>
      key ? vocabularySpansByCue[key] : undefined,
    [vocabularySpansByCue]
  )

  return {
    prepareWholeTrackVocabulary,
    vocabularySpans,
    spansForCue,
    refs: {
      tokenCache,
      tokenizeToken,
      knownLevelsCache,
      knownLevelsToken,
      allCuesToken,
      allCuesLevelsToken
    },
    invalidateVocabularySpans
  }
}
