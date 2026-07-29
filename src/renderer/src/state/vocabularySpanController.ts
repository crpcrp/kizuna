import type { FrequencyMode, LookupResult } from '../../../shared/dictionary'
import {
  maxKnowledgeLevel,
  type KnowledgeDetails,
  type KnowledgeLevel
} from '../../../shared/knowledge'
import type { Token } from '../../../shared/token'
import {
  buildWordLookupRequest,
  lookupWord,
  type DictLookupBridge,
  type WordLookupRequest
} from './playerActions'
import {
  deriveVocabularySpans,
  type VocabularySpan,
  type VocabularySpanLookup
} from './vocabularySpans'

export interface VocabularySpanEpoch {
  file: number
  track: number
  tokenization: number
  dictionary: number
  knowledge: number
}

export interface VocabularySpanResolveInput {
  dict: DictLookupBridge
  knowledge: { detailsFor(expressions: string[]): Promise<Record<string, KnowledgeDetails>> }
  cues: { cueKey: string; tokens: Token[] }[]
  frequencyDictId: number | null
  sortOrder?: 'auto' | FrequencyMode
  epoch: VocabularySpanEpoch
  concurrency?: number
}

export type VocabularySpanResolveResult =
  { kind: 'resolved'; spansByCue: Record<string, VocabularySpan[]> } | { kind: 'stale' }

export interface VocabularySpanController {
  resolve(input: VocabularySpanResolveInput): Promise<VocabularySpanResolveResult>
  invalidate(): void
}

/**
 * Resolves once. Callers that receive stale may explicitly request their new snapshot;
 * this boundary never retries indefinitely.
 */
export async function retryStaleVocabularySpanResolve(
  resolve: () => Promise<VocabularySpanResolveResult>,
  _isCurrent: () => boolean
): Promise<VocabularySpanResolveResult> {
  return resolve()
}

interface ResolvedLookup {
  cueKey: string
  tokenOffset: number
  result: VocabularySpanLookup['result']
}

/** Resolves and caches whole-track compound spans without allowing stale work to publish. */
export function createVocabularySpanController(): VocabularySpanController {
  let generation = 0
  let currentEpochKey: string | undefined
  const completed = new Map<string, VocabularySpanResolveResult>()
  const inFlight = new Map<string, Promise<VocabularySpanResolveResult>>()

  const beginEpoch = (input: VocabularySpanResolveInput): number => {
    const epochKey = snapshotEpochKey(input)
    if (currentEpochKey !== epochKey) {
      currentEpochKey = epochKey
      generation++
      completed.clear()
    }
    return generation
  }

  return {
    resolve(input): Promise<VocabularySpanResolveResult> {
      const requestGeneration = beginEpoch(input)
      const key = requestKey(input)
      const cached = completed.get(key)
      if (cached) return Promise.resolve(cached)

      const existing = inFlight.get(key)
      if (existing) return existing

      const request = resolveSpans(input, requestGeneration, () => generation)
      inFlight.set(key, request)
      void request
        .then((resolved) => {
          if (generation === requestGeneration && resolved.kind === 'resolved')
            completed.set(key, resolved)
        })
        .finally(() => {
          if (inFlight.get(key) === request) inFlight.delete(key)
        })
      return request
    },

    invalidate(): void {
      generation++
      currentEpochKey = undefined
      completed.clear()
      inFlight.clear()
    }
  }
}

async function resolveSpans(
  input: VocabularySpanResolveInput,
  requestGeneration: number,
  getGeneration: () => number
): Promise<VocabularySpanResolveResult> {
  const spansByCue: Record<string, VocabularySpan[]> = {}
  const lookups: ResolvedLookup[] = []
  const lookupRequests = new Map<string, Promise<LookupResult[]>>()
  const work = input.cues.flatMap((cue) => cue.tokens.map((token) => ({ cue, token })))
  let next = 0
  const workers = Array.from(
    { length: Math.min(Math.max(1, input.concurrency ?? 4), work.length) },
    async () => {
      while (next < work.length) {
        const item = work[next++]
        try {
          const request = buildWordLookupRequest(
            item.token,
            input.frequencyDictId,
            input.sortOrder,
            item.cue.tokens
          )
          const results = lookupRequest(input.dict, request, lookupRequests)
          for (const result of await results) {
            lookups.push({
              cueKey: item.cue.cueKey,
              tokenOffset: item.token.startOffset,
              result
            })
          }
        } catch {
          // A failed lookup leaves this cue without spans while successful cues still resolve.
        }
      }
    }
  )
  await Promise.all(workers)
  if (getGeneration() !== requestGeneration) return { kind: 'stale' }

  // A token's vocabulary identity is its top-ranked lookup result — the same
  // entry the word popup displays first. A lower-ranked alternative headword
  // (ヤツ or 八つ for a token whose top entry is 奴) must never drive the
  // single-token projection, or a known word colors as unknown.
  const topLookups = new Map<string, ResolvedLookup>()
  for (const lookup of lookups) {
    const key = topLookupKey(lookup.cueKey, lookup.tokenOffset)
    if (!topLookups.has(key)) topLookups.set(key, lookup)
  }

  const identities = [
    ...new Set([
      ...lookups.flatMap(({ result }) =>
        [result.expression, result.matchedSurface].filter((identity): identity is string =>
          Boolean(identity)
        )
      ),
      ...input.cues.flatMap((cue) =>
        cue.tokens.flatMap((token) =>
          singleTokenProjection(cue.cueKey, token, topLookups) ? [token.lemma, token.surface] : []
        )
      )
    ])
  ]
  let details: Record<string, KnowledgeDetails>
  try {
    details = identities.length === 0 ? {} : await input.knowledge.detailsFor(identities)
  } catch {
    return getGeneration() === requestGeneration
      ? { kind: 'resolved', spansByCue }
      : { kind: 'stale' }
  }
  if (getGeneration() !== requestGeneration) return { kind: 'stale' }

  for (const cue of input.cues) {
    const cueLookups: VocabularySpanLookup[] = lookups
      .filter((lookup) => lookup.cueKey === cue.cueKey)
      .map((lookup) => ({
        ...lookup,
        level: resolvedLevel(lookup.result.expression, lookup.result.matchedSurface, details)
      }))
    const spans = deriveVocabularySpans(cue.cueKey, cue.tokens, cueLookups)
    for (const token of cue.tokens) {
      const top = singleTokenProjection(cue.cueKey, token, topLookups)
      if (!top) continue
      const endOffset = token.startOffset + token.surface.length
      if (spans.some((span) => token.startOffset < span.endOffset && endOffset > span.startOffset))
        continue
      spans.push({
        cueKey: cue.cueKey,
        startOffset: token.startOffset,
        endOffset,
        memberTokenOffsets: [token.startOffset],
        expression: top.result.expression,
        matchedSurface: token.surface,
        // MeCab's lemma and the raw surface key into the knowledge DB just as
        // validly as the dictionary headword: 奴 known means ヤツ is known.
        level: [token.lemma, token.surface].reduce<KnowledgeLevel>(
          (level, identity) => maxKnowledgeLevel(level, details[identity]?.level ?? 'unknown'),
          resolvedLevel(top.result.expression, top.result.matchedSurface, details)
        )
      })
    }
    spansByCue[cue.cueKey] = spans
  }
  return { kind: 'resolved', spansByCue }
}

function lookupRequest(
  dict: DictLookupBridge,
  request: WordLookupRequest,
  lookupRequests: Map<string, Promise<LookupResult[]>>
): Promise<LookupResult[]> {
  const key = JSON.stringify(request)
  const cached = lookupRequests.get(key)
  if (cached) return cached

  let lookup: Promise<LookupResult[]>
  try {
    lookup = lookupWord(dict, request)
  } catch (error) {
    lookup = Promise.reject(error)
  }
  lookupRequests.set(key, lookup)
  return lookup
}

function topLookupKey(cueKey: string, tokenOffset: number): string {
  return `${cueKey}\u0000${tokenOffset}`
}

/**
 * The top-ranked lookup for one token, when it projects that token onto a
 * dictionary headword other than its own lemma (a fused にしても token whose
 * lemma is にして, or a katakana ヤツ surface whose entry is written 奴).
 */
function singleTokenProjection(
  cueKey: string,
  token: Token,
  topLookups: Map<string, ResolvedLookup>
): ResolvedLookup | undefined {
  const top = topLookups.get(topLookupKey(cueKey, token.startOffset))
  return top && top.result.matchedSurface === token.surface && top.result.expression !== token.lemma
    ? top
    : undefined
}

function snapshotEpochKey(input: VocabularySpanResolveInput): string {
  const { epoch, frequencyDictId, sortOrder = 'auto' } = input
  return `${epoch.file}|${epoch.track}|${epoch.tokenization}|${epoch.dictionary}|${epoch.knowledge}|${frequencyDictId}|${sortOrder}`
}

const tokenIds = new WeakMap<Token, number>()
let nextTokenId = 0

function tokenIdentity(token: Token): number {
  let id = tokenIds.get(token)
  if (id === undefined) {
    id = ++nextTokenId
    tokenIds.set(token, id)
  }
  return id
}

function requestKey(input: VocabularySpanResolveInput): string {
  return `${snapshotEpochKey(input)}|${input.cues
    .map((cue) => `${cue.cueKey}:${cue.tokens.map(tokenIdentity).join(',')}`)
    .join('|')}`
}

function resolvedLevel(
  expression: string,
  matchedSurface: string | undefined,
  details: Record<string, KnowledgeDetails>
): KnowledgeLevel {
  return matchedSurface && details[matchedSurface]
    ? maxKnowledgeLevel(details[expression]?.level ?? 'unknown', details[matchedSurface].level)
    : (details[expression]?.level ?? 'unknown')
}
