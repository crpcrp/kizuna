import type { FrequencyMode } from '../../../shared/dictionary'
import type { Cue } from '../../../shared/cue'
import type { KnowledgeDetails, KnowledgeLevel } from '../../../shared/knowledge'
import type { Token } from '../../../shared/token'
import {
  cueKey,
  tokenizeAllCues,
  type DictLookupBridge,
  type Dispatch,
  type KnowledgeBridge,
  type MecabBatchBridge,
  type SubtitleRequestToken
} from './playerActions'
import {
  createVocabularySpanController,
  type VocabularySpanController,
  type VocabularySpanEpoch
} from './vocabularySpanController'
import type { VocabularySpan } from './vocabularySpans'

export interface WholeTrackVocabularySnapshot {
  cueTokens: { cueKey: string; tokens: Token[] }[]
  spansByCue: Record<string, VocabularySpan[]>
}

export type WholeTrackVocabularyResult =
  | { kind: 'ready'; snapshot: WholeTrackVocabularySnapshot }
  | { kind: 'stale' }
  | { kind: 'error'; message: string }

export interface WholeTrackVocabularyInput {
  mecab: MecabBatchBridge
  dict: DictLookupBridge
  knowledge: KnowledgeBridge & {
    detailsFor(expressions: string[]): Promise<Record<string, KnowledgeDetails>>
  }
  dispatch: Dispatch
  cues: Cue[]
  tokenCache: Map<string, Token[]>
  knownLevelsCache: Map<string, KnowledgeLevel>
  allCuesToken: SubtitleRequestToken
  allCuesLevelsToken: SubtitleRequestToken
  frequencyDictId: number | null
  sortOrder?: 'auto' | FrequencyMode
  epoch: VocabularySpanEpoch
}

export interface WholeTrackVocabularyCoordinator {
  prepare(input: WholeTrackVocabularyInput): Promise<WholeTrackVocabularyResult>
  invalidate(): void
}

/**
 * Owns the complete vocabulary snapshot used by whole-track consumers. The
 * key deliberately excludes Anki configuration: it changes mining behavior,
 * not tokenization, dictionary ranking, or knowledge-derived vocabulary.
 */
export function createWholeTrackVocabularyCoordinator(
  spanController: VocabularySpanController = createVocabularySpanController()
): WholeTrackVocabularyCoordinator {
  let generation = 0
  let currentKey: string | undefined
  const completed = new Map<string, WholeTrackVocabularyResult>()
  const inFlight = new Map<string, Promise<WholeTrackVocabularyResult>>()

  return {
    prepare(input): Promise<WholeTrackVocabularyResult> {
      const key = preparationKey(input)
      if (currentKey !== key) {
        currentKey = key
        generation++
        completed.clear()
        inFlight.clear()
      }
      const requestGeneration = generation
      const cached = completed.get(key)
      if (cached) return Promise.resolve(cached)
      const existing = inFlight.get(key)
      if (existing) return existing

      const request = prepareSnapshot(input, spanController, requestGeneration, () => generation)
      inFlight.set(key, request)
      void request
        .then((result) => {
          if (generation === requestGeneration && result.kind === 'ready')
            completed.set(key, result)
        })
        .finally(() => {
          if (inFlight.get(key) === request) inFlight.delete(key)
        })
      return request
    },

    invalidate(): void {
      generation++
      currentKey = undefined
      completed.clear()
      inFlight.clear()
      spanController.invalidate()
    }
  }
}

async function prepareSnapshot(
  input: WholeTrackVocabularyInput,
  spanController: VocabularySpanController,
  requestGeneration: number,
  getGeneration: () => number
): Promise<WholeTrackVocabularyResult> {
  try {
    const tokenSnapshot = await tokenizeAllCues(
      input.mecab,
      input.knowledge,
      input.dispatch,
      input.cues,
      input.tokenCache,
      input.knownLevelsCache,
      input.allCuesToken,
      input.allCuesLevelsToken
    )
    if (!tokenSnapshot || getGeneration() !== requestGeneration) return { kind: 'stale' }

    const cueTokens = input.cues.map((cue) => {
      const key = cueKey(cue)
      return { cueKey: key, tokens: tokenSnapshot[key] ?? [] }
    })
    const spans = await spanController.resolve({
      dict: input.dict,
      knowledge: input.knowledge,
      cues: cueTokens,
      frequencyDictId: input.frequencyDictId,
      sortOrder: input.sortOrder,
      epoch: input.epoch
    })
    if (getGeneration() !== requestGeneration || spans.kind === 'stale') return { kind: 'stale' }
    return { kind: 'ready', snapshot: { cueTokens, spansByCue: spans.spansByCue } }
  } catch {
    return getGeneration() === requestGeneration
      ? { kind: 'error', message: 'Could not prepare whole-track vocabulary.' }
      : { kind: 'stale' }
  }
}

function preparationKey(input: WholeTrackVocabularyInput): string {
  const { epoch, frequencyDictId, sortOrder = 'auto' } = input
  return [
    epoch.file,
    epoch.track,
    epoch.tokenization,
    epoch.dictionary,
    epoch.knowledge,
    frequencyDictId ?? 'none',
    sortOrder,
    ...input.cues.map(cueKey)
  ].join('|')
}
