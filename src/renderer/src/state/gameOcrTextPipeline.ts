import type { FrequencyMode } from '../../../shared/dictionary'
import {
  maxKnowledgeLevel,
  type KnowledgeDetails,
  type KnowledgeLevel
} from '../../../shared/knowledge'
import type { OcrCaptureIdentity } from '../../../shared/ocr'
import type { Token } from '../../../shared/token'
import type { MecabBatchBridge } from './tokenization'
import {
  createVocabularySpanController,
  type VocabularySpanController
} from './vocabularySpanController'
import type { VocabularySpan } from './vocabularySpans'
import type { DictLookupBridge } from './wordLookup'

export interface InteractiveTextRegion {
  id: string
  text: string
}

export interface GameOcrTextRegion extends InteractiveTextRegion {
  tokens: Token[]
  levels: Record<string, KnowledgeLevel>
  vocabularySpans: VocabularySpan[]
}

export interface GameOcrTextSnapshot extends OcrCaptureIdentity {
  regions: Record<string, GameOcrTextRegion>
}

export type GameOcrTextResult =
  { kind: 'resolved'; snapshot: GameOcrTextSnapshot } | { kind: 'stale' }

export interface GameOcrKnowledgeBridge {
  levelsFor(identities: string[]): Promise<Record<string, KnowledgeLevel>>
  detailsFor(identities: string[]): Promise<Record<string, KnowledgeDetails>>
}

export interface GameOcrTextPipelineOptions {
  mecab: MecabBatchBridge
  dict: DictLookupBridge
  knowledge: GameOcrKnowledgeBridge
  frequencyDictId?: number | null
  sortOrder?: 'auto' | FrequencyMode
}

export interface GameOcrTextPipeline {
  process(
    identity: OcrCaptureIdentity,
    regions: InteractiveTextRegion[]
  ): Promise<GameOcrTextResult>
  invalidate(): void
}

interface RegionCacheEntry {
  text: string
  result: GameOcrTextRegion
}

/** Processes one capture at a time and never publishes work from a superseded capture. */
export function createGameOcrTextPipeline(
  options: GameOcrTextPipelineOptions
): GameOcrTextPipeline {
  let generation = 0
  let activeCapture: string | undefined
  let regionCache = new Map<string, RegionCacheEntry>()
  let levelCache = new Map<string, KnowledgeLevel>()
  const spans = createVocabularySpanController()

  const invalidate = (): void => {
    generation++
    activeCapture = undefined
    regionCache.clear()
    levelCache.clear()
    spans.invalidate()
  }

  return {
    async process(identity, regions): Promise<GameOcrTextResult> {
      const capture = captureKey(identity)
      if (capture !== activeCapture) {
        activeCapture = capture
        regionCache = new Map()
        levelCache = new Map()
      }

      const requestGeneration = ++generation
      spans.invalidate()
      const isCurrent = (): boolean => generation === requestGeneration && activeCapture === capture

      const cached = new Map<string, GameOcrTextRegion>()
      const missing: InteractiveTextRegion[] = []
      for (const region of regions) {
        const entry = regionCache.get(region.id)
        if (entry?.text === region.text) cached.set(region.id, entry.result)
        else missing.push(region)
      }

      const tokensByRegion = await tokenizeRegions(options.mecab, missing)
      if (!isCurrent()) return { kind: 'stale' }

      const missingTokens = missing.flatMap((region) => tokensByRegion.get(region.id) ?? [])
      await resolveLevels(options.knowledge, missingTokens, levelCache)
      if (!isCurrent()) return { kind: 'stale' }

      const spanResult = await resolveSpans(
        spans,
        options,
        identity,
        missing,
        tokensByRegion,
        requestGeneration
      )
      if (!isCurrent() || spanResult.kind === 'stale') return { kind: 'stale' }

      const nextCache = new Map<string, RegionCacheEntry>()
      const snapshot: Record<string, GameOcrTextRegion> = {}
      for (const region of regions) {
        const cachedResult = cached.get(region.id)
        const tokens = tokensByRegion.get(region.id) ?? []
        const result =
          cachedResult ??
          ({
            id: region.id,
            text: region.text,
            tokens,
            levels: levelsForTokens(tokens, levelCache),
            vocabularySpans: spanResult.spansByCue[region.id] ?? []
          } satisfies GameOcrTextRegion)
        snapshot[region.id] = result
        nextCache.set(region.id, { text: region.text, result })
      }
      regionCache = nextCache

      return {
        kind: 'resolved',
        snapshot: { ...identity, regions: snapshot }
      }
    },

    invalidate
  }
}

async function tokenizeRegions(
  mecab: MecabBatchBridge,
  regions: InteractiveTextRegion[]
): Promise<Map<string, Token[]>> {
  const result = new Map(regions.map((region) => [region.id, [] as Token[]]))
  const japanese = regions.filter((region) => containsJapanese(region.text))
  if (japanese.length === 0) return result

  try {
    const batches = await mecab.tokenizeBatch(japanese.map((region) => region.text))
    japanese.forEach((region, index) => result.set(region.id, batches[index] ?? []))
  } catch {
    // MeCab failure leaves every affected region as its original selectable text.
  }
  return result
}

async function resolveLevels(
  knowledge: GameOcrKnowledgeBridge,
  tokens: Token[],
  cache: Map<string, KnowledgeLevel>
): Promise<void> {
  const uncached = tokens.filter((token) => !cache.has(token.lemma))
  if (uncached.length === 0) return
  const identities = [
    ...new Set(
      uncached.flatMap((token) =>
        token.surface === token.lemma ? [token.lemma] : [token.lemma, token.surface]
      )
    )
  ]

  let resolved: Record<string, KnowledgeLevel>
  try {
    resolved = await knowledge.levelsFor(identities)
  } catch {
    resolved = {}
  }

  for (const token of uncached) {
    cache.set(
      token.lemma,
      maxKnowledgeLevel(resolved[token.lemma] ?? 'unknown', resolved[token.surface] ?? 'unknown')
    )
  }
}

async function resolveSpans(
  controller: VocabularySpanController,
  options: GameOcrTextPipelineOptions,
  identity: OcrCaptureIdentity,
  regions: InteractiveTextRegion[],
  tokensByRegion: Map<string, Token[]>,
  generation: number
) {
  return controller.resolve({
    dict: options.dict,
    knowledge: options.knowledge,
    cues: regions.map((region) => ({
      cueKey: region.id,
      tokens: tokensByRegion.get(region.id) ?? []
    })),
    frequencyDictId: options.frequencyDictId ?? null,
    sortOrder: options.sortOrder,
    epoch: {
      file: identity.sessionId,
      track: identity.captureId,
      tokenization: generation,
      dictionary: 0,
      knowledge: 0
    }
  })
}

function levelsForTokens(
  tokens: Token[],
  cache: Map<string, KnowledgeLevel>
): Record<string, KnowledgeLevel> {
  return Object.fromEntries(
    tokens.map((token) => [token.lemma, cache.get(token.lemma) ?? 'unknown'])
  )
}

function containsJapanese(text: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
}

function captureKey(identity: OcrCaptureIdentity): string {
  return `${identity.sessionId}:${identity.captureId}`
}
