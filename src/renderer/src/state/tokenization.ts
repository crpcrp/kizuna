// MeCab tokenization and knowledge-level resolution for subtitle cues: the
// active cue (interactive path) and whole-track batches (sidebar/report path).
// Both are guarded by a shared request token so a superseded run never lands.

import { type Cue } from '../../../shared/cue'
import { type KnowledgeLevel, maxKnowledgeLevel } from '../../../shared/knowledge'
import { type Token } from '../../../shared/token'
import { type Dispatch, type SubtitleRequestToken } from './mediaSession'

/** Subset of the preload `kizuna.mecab` bridge that tokenizeActiveCue needs. */
export interface MecabBridge {
  tokenize(text: string): Promise<Token[]>
}

/** Stable identity for a cue, used both as a cache key and to detect that the
 * active cue changed (vs. the same cue still being active on a later tick). */
export function cueKey(cue: Cue): string {
  return `${cue.start}|${cue.end}|${cue.text}`
}

/**
 * Tokenizes the currently-active cue via MeCab, lazily and with caching: a
 * cue already tokenized (by `cueKey`) is served from `cache` without calling
 * the bridge again, so scrubbing back to a previously-active cue is free.
 * `tokenizeToken` guards against stale resolutions the same way
 * `SubtitleRequestToken` guards subtitle loads — the caller (App.tsx) should
 * share one instance across calls for the same player instance.
 */
export async function tokenizeActiveCue(
  bridge: MecabBridge,
  dispatch: Dispatch,
  cue: Cue | undefined,
  cache: Map<string, Token[]>,
  tokenizeToken: SubtitleRequestToken = { current: 0 }
): Promise<Token[]> {
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

  // Cache miss: clear stale tokens from the previously-active cue synchronously
  // (before awaiting the bridge) so SubtitleOverlay falls back to this cue's
  // plain text while tokenizing is in flight, instead of rendering leftover
  // token spans from whatever cue was active before.
  dispatch({ type: 'activeTokensLoaded', tokens: [] })

  const requestId = ++tokenizeToken.current
  const tokens = await bridge.tokenize(cue.text)
  // Stale: don't dispatch, and return [] rather than these (now-superseded)
  // tokens so a chained caller (e.g. resolveKnownLevels in App.tsx) treats
  // this resolution as a no-op too, instead of resolving levels for a cue
  // that's no longer active.
  if (tokenizeToken.current !== requestId) return []
  cache.set(key, tokens)
  dispatch({ type: 'activeTokensLoaded', tokens })
  return tokens
}

/** Subset of the preload `kizuna.knowledge` bridge that resolveKnownLevels needs. */
export interface KnowledgeBridge {
  levelsFor(lemmas: string[]): Promise<Record<string, KnowledgeLevel>>
}

/**
 * Resolves knowledge levels (unknown/inDeck/learning/known/wellKnown) for a cue's
 * tokens, lazily and with caching — the same shape as `tokenizeActiveCue`.
 * Only lemmas not already present in `cache` are queried, together with each
 * distinct surface that differs from its lemma. A cue repeating a word costs
 * one lookup per distinct key; already-cached lemmas are simply
 * skipped, since `cache` and the reducer's `knownLevels` accumulate over the
 * whole episode rather than resetting per cue (unlike `activeTokens`). If
 * every lemma is already cached (or `tokens` is empty), this is a no-op: no
 * bridge call, no dispatch. `requestToken` guards against a stale resolution
 * the same way `tokenizeActiveCue`'s does — the caller (App.tsx) should share
 * one instance across calls for the same player instance.
 */
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

/** Subset of the preload `kizuna.mecab` bridge that tokenizeAllCues needs. */
export interface MecabBatchBridge {
  tokenizeBatch(texts: string[]): Promise<Token[][]>
}

/**
 * Tokenizes *every* cue of a track (for the subtitle sidebar's per-word
 * coloring), reusing the same per-cue `tokenCache` (keyed by `cueKey`) that
 * `tokenizeActiveCue` warms — so cues already tokenized while playing are not
 * re-sent to MeCab. Only the cache-miss cues are batch-tokenized in one bridge
 * round-trip (`tokenizeBatch`). Dispatches `allCueTokensLoaded` with the full
 * `cueKey -> Token[]` map, then resolves knowledge levels for every lemma in
 * the track via the shared `resolveKnownLevels` primitive (which itself only
 * queries lemmas missing from `knownLevelsCache`). `requestToken` guards
 * against a stale resolution the same way the other orchestration functions do
 * — if the track changes mid-flight, the superseded call neither dispatches nor
 * resolves levels. Returns the complete snapshot used for a current request;
 * a stale request returns `undefined`. No-op (empty dispatch) for an empty cue
 * list.
 */
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
    const batches = await mecab.tokenizeBatch(missing.map((cue) => cue.text))
    // A newer request started while MeCab was running: discard this result
    // rather than writing a superseded track's tokens into state.
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
