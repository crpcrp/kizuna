import { type Cue } from '../../../shared/cue'
import { type KnowledgeLevel, maxKnowledgeLevel } from '../../../shared/knowledge'
import { displayTextProjection } from '../../../shared/textProjection'
import { type Token } from '../../../shared/token'
import { type Dispatch, type SubtitleRequestToken } from './mediaSession'

export interface VocabularyCaches {
  tokenCache: Map<string, Token[]>
  knownLevelsCache: Map<string, KnowledgeLevel>
  // Active-cue and sidebar requests share caches, but must not cancel each other.
  tokens: {
    active: SubtitleRequestToken
    levels: SubtitleRequestToken
    allCues: SubtitleRequestToken
    allCuesLevels: SubtitleRequestToken
  }
}

export function createVocabularyCaches(): VocabularyCaches {
  return {
    tokenCache: new Map(),
    knownLevelsCache: new Map(),
    tokens: {
      active: { current: 0 },
      levels: { current: 0 },
      allCues: { current: 0 },
      allCuesLevels: { current: 0 }
    }
  }
}

export interface MecabBridge {
  tokenize(text: string): Promise<Token[]>
}

export function cueKey(cue: Cue): string {
  return `${cue.start}|${cue.end}|${cue.text}`
}

// Join wrapped lines without separators so MeCab sees complete words and offsets remain continuous.
function cueAnalysisText(cue: Cue): string {
  return displayTextProjection(cue.text).analysisText
}

export async function tokenizeActiveCue(
  bridge: MecabBridge,
  dispatch: Dispatch,
  cue: Cue | undefined,
  cache: Map<string, Token[]>,
  tokenizeToken: SubtitleRequestToken = { current: 0 }
): Promise<Token[]> {
  const requestId = ++tokenizeToken.current
  if (!cue) {
    dispatch({ type: 'activeTokensLoaded', tokens: [] })
    return []
  }

  const key = cueKey(cue)
  const cached = cache.get(key)
  if (cached) {
    dispatch({ type: 'activeTokensLoaded', tokens: cached })
    return cached
  }

  // Clear old tokens before awaiting MeCab so the new cue displays plain text rather than stale spans.
  dispatch({ type: 'activeTokensLoaded', tokens: [] })

  const tokens = await bridge.tokenize(cueAnalysisText(cue))
  // Return no stale tokens so chained knowledge resolution cannot process a superseded cue.
  if (tokenizeToken.current !== requestId) return []
  cache.set(key, tokens)
  dispatch({ type: 'activeTokensLoaded', tokens })
  return tokens
}

export interface KnowledgeBridge {
  levelsFor(lemmas: string[]): Promise<Record<string, KnowledgeLevel>>
}

export async function resolveKnownLevels(
  bridge: KnowledgeBridge,
  dispatch: Dispatch,
  tokens: Token[],
  cache: Map<string, KnowledgeLevel>,
  requestToken: SubtitleRequestToken = { current: 0 }
): Promise<void> {
  const newTokens = tokens.filter((token) => !cache.has(token.lemma))
  const newLemmas = [...new Set(newTokens.map((token) => token.lemma))]
  if (newLemmas.length === 0) return

  const queryKeys = [
    ...new Set(
      newTokens.flatMap((token) =>
        token.surface === token.lemma ? [token.lemma] : [token.lemma, token.surface]
      )
    )
  ]

  const requestId = ++requestToken.current
  const levels = await bridge.levelsFor(queryKeys)
  if (requestToken.current !== requestId) return

  // The database returns rows only for known lemmas. Cache omitted rows as
  // unknown too, otherwise every visit to an unknown word repeats the lookup.
  const resolved = Object.fromEntries(
    newLemmas.map((lemma) => {
      const surfaces = newTokens
        .filter((token) => token.lemma === lemma)
        .map((token) => token.surface)
      const level = surfaces.reduce<KnowledgeLevel>(
        (current, surface) => maxKnowledgeLevel(current, levels[surface] ?? 'unknown'),
        levels[lemma] ?? 'unknown'
      )
      return [lemma, level] as const
    })
  ) as Record<string, KnowledgeLevel>
  for (const [lemma, level] of Object.entries(resolved)) cache.set(lemma, level)
  dispatch({ type: 'knownLevelsLoaded', levels: resolved })
}

export interface MecabBatchBridge {
  tokenizeBatch(texts: string[]): Promise<Token[][]>
}

export async function tokenizeAllCues(
  mecab: MecabBatchBridge,
  knowledge: KnowledgeBridge,
  dispatch: Dispatch,
  cues: Cue[],
  tokenCache: Map<string, Token[]>,
  knownLevelsCache: Map<string, KnowledgeLevel>,
  requestToken: SubtitleRequestToken = { current: 0 },
  levelsToken: SubtitleRequestToken = { current: 0 }
): Promise<Record<string, Token[]> | undefined> {
  const requestId = ++requestToken.current

  const missing = cues.filter((cue) => !tokenCache.has(cueKey(cue)))
  if (missing.length > 0) {
    const batches = await mecab.tokenizeBatch(missing.map(cueAnalysisText))
    if (requestToken.current !== requestId) return undefined
    missing.forEach((cue, i) => tokenCache.set(cueKey(cue), batches[i] ?? []))
  }

  const allTokens: Record<string, Token[]> = {}
  for (const cue of cues) {
    allTokens[cueKey(cue)] = tokenCache.get(cueKey(cue)) ?? []
  }
  dispatch({ type: 'allCueTokensLoaded', tokens: allTokens })

  const everyToken = cues.flatMap((cue) => tokenCache.get(cueKey(cue)) ?? [])
  await resolveKnownLevels(knowledge, dispatch, everyToken, knownLevelsCache, levelsToken)
  return allTokens
}
