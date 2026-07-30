import { describe, it, expect, vi } from 'vitest'
import { type SubtitleRequestToken } from '@src/renderer/src/state/mediaSession'
import {
  type KnowledgeBridge,
  type MecabBatchBridge,
  type MecabBridge,
  cueKey,
  resolveKnownLevels,
  tokenizeActiveCue,
  tokenizeAllCues
} from '@src/renderer/src/state/tokenization'
import { type Cue } from '@src/shared/cue'
import { type KnowledgeLevel } from '@src/shared/knowledge'
import { type Token } from '@src/shared/token'
import { deferred } from '@test/harness/playerActionFakes'

describe('cueKey', () => {
  it('is stable for identical cues and differs when any field changes', () => {
    const a: Cue = { start: 1, end: 2, text: 'hi' }
    const b: Cue = { start: 1, end: 2, text: 'hi' }
    const c: Cue = { start: 1, end: 3, text: 'hi' }
    expect(cueKey(a)).toBe(cueKey(b))
    expect(cueKey(a)).not.toBe(cueKey(c))
  })
})

describe('tokenizeActiveCue', () => {
  const tokenA: Token = { surface: 'a', reading: '', lemma: 'a', pos: 'noun', startOffset: 0 }
  const cue: Cue = { start: 0, end: 1, text: 'hi' }

  function makeMecabBridge(): MecabBridge {
    return { tokenize: vi.fn().mockResolvedValue([tokenA]) }
  }

  it('no active cue: dispatches empty tokens without calling the bridge', async () => {
    const bridge = makeMecabBridge()
    const dispatch = vi.fn()

    const result = await tokenizeActiveCue(bridge, dispatch, undefined, new Map())

    expect(bridge.tokenize).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({ type: 'activeTokensLoaded', tokens: [] })
    expect(result).toEqual([])
  })

  it('cache miss: calls the bridge once, dispatches the result, and populates the cache', async () => {
    const bridge = makeMecabBridge()
    const dispatch = vi.fn()
    const cache = new Map<string, Token[]>()

    const result = await tokenizeActiveCue(bridge, dispatch, cue, cache)

    expect(bridge.tokenize).toHaveBeenCalledTimes(1)
    expect(bridge.tokenize).toHaveBeenCalledWith('hi')
    expect(dispatch).toHaveBeenCalledWith({ type: 'activeTokensLoaded', tokens: [tokenA] })
    expect(cache.get(cueKey(cue))).toEqual([tokenA])
    expect(result).toEqual([tokenA])
  })

  it('cache miss: clears stale tokens synchronously first, then dispatches the real tokens once resolved', async () => {
    const first = deferred<Token[]>()
    const tokenize = vi.fn().mockReturnValue(first.promise)
    const bridge: MecabBridge = { tokenize }
    const dispatch = vi.fn()
    const cache = new Map<string, Token[]>()

    const call = tokenizeActiveCue(bridge, dispatch, cue, cache)

    // The empty-clear dispatch happens synchronously, before the bridge
    // promise resolves — so it's already observable here.
    expect(dispatch.mock.calls[0]).toEqual([{ type: 'activeTokensLoaded', tokens: [] }])

    first.resolve([tokenA])
    await call

    expect(dispatch.mock.calls[1]).toEqual([{ type: 'activeTokensLoaded', tokens: [tokenA] }])
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('cache hit: does not call the bridge again, dispatches the cached tokens', async () => {
    const bridge = makeMecabBridge()
    const dispatch = vi.fn()
    const cache = new Map<string, Token[]>([[cueKey(cue), [tokenA]]])

    const result = await tokenizeActiveCue(bridge, dispatch, cue, cache)

    expect(bridge.tokenize).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'activeTokensLoaded', tokens: [tokenA] })
    expect(result).toEqual([tokenA])
  })

  it('a stale (superseded) request does not dispatch the superseded result (but still clears stale tokens up front)', async () => {
    const first = deferred<Token[]>()
    const tokenize = vi.fn().mockReturnValue(first.promise)
    const bridge: MecabBridge = { tokenize }
    const dispatch = vi.fn()
    const cache = new Map<string, Token[]>()
    const token: SubtitleRequestToken = { current: 0 }

    const call = tokenizeActiveCue(bridge, dispatch, cue, cache, token)
    // Supersede before the bridge call resolves.
    token.current++
    first.resolve([tokenA])
    const result = await call

    // Only the synchronous empty-clear dispatch happened; the superseded
    // real result was never dispatched.
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0]).toEqual([{ type: 'activeTokensLoaded', tokens: [] }])
    // A stale result must not repopulate the cache after an invalidation.
    expect(cache.has(cueKey(cue))).toBe(false)
    // The return value is also suppressed for stale requests, so a chained
    // caller (resolveKnownLevels in App.tsx) treats this as a no-op too.
    expect(result).toEqual([])
  })
})

describe('resolveKnownLevels', () => {
  const tokenA: Token = {
    surface: 'lemmaA',
    reading: '',
    lemma: 'lemmaA',
    pos: 'noun',
    startOffset: 0
  }
  const tokenB: Token = {
    surface: 'lemmaB',
    reading: '',
    lemma: 'lemmaB',
    pos: 'noun',
    startOffset: 1
  }
  const tokenARepeat: Token = {
    surface: 'lemmaA',
    reading: '',
    lemma: 'lemmaA',
    pos: 'noun',
    startOffset: 2
  }

  function makeKnowledgeBridge(overrides: Partial<KnowledgeBridge> = {}): KnowledgeBridge {
    return {
      levelsFor: vi.fn().mockResolvedValue({ lemmaA: 'known', lemmaB: 'unknown' }),
      ...overrides
    }
  }

  it('empty token input: dispatches nothing and does not call the bridge', async () => {
    const bridge = makeKnowledgeBridge()
    const dispatch = vi.fn()

    await resolveKnownLevels(bridge, dispatch, [], new Map())

    expect(bridge.levelsFor).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('cache hits skip the call: every lemma already cached dispatches nothing', async () => {
    const bridge = makeKnowledgeBridge()
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>([
      ['lemmaA', 'known'],
      ['lemmaB', 'unknown']
    ])

    await resolveKnownLevels(bridge, dispatch, [tokenA, tokenB], cache)

    expect(bridge.levelsFor).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('cache miss: dedupes repeated lemmas, queries only uncached ones, populates the cache, and dispatches', async () => {
    const bridge = makeKnowledgeBridge()
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>()

    await resolveKnownLevels(bridge, dispatch, [tokenA, tokenARepeat, tokenB], cache)

    expect(bridge.levelsFor).toHaveBeenCalledTimes(1)
    expect(bridge.levelsFor).toHaveBeenCalledWith(['lemmaA', 'lemmaB'])
    expect(cache.get('lemmaA')).toBe('known')
    expect(cache.get('lemmaB')).toBe('unknown')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'knownLevelsLoaded',
      levels: { lemmaA: 'known', lemmaB: 'unknown' }
    })
  })

  it('queries only the lemmas not already cached', async () => {
    const bridge = makeKnowledgeBridge({
      levelsFor: vi.fn().mockResolvedValue({ lemmaB: 'unknown' })
    })
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>([['lemmaA', 'known']])

    await resolveKnownLevels(bridge, dispatch, [tokenA, tokenB], cache)

    expect(bridge.levelsFor).toHaveBeenCalledWith(['lemmaB'])
    expect(dispatch).toHaveBeenCalledWith({
      type: 'knownLevelsLoaded',
      levels: { lemmaB: 'unknown' }
    })
  })

  it('caches and dispatches missing rows as unknown so they are not re-queried', async () => {
    const bridge = makeKnowledgeBridge({
      levelsFor: vi.fn().mockResolvedValue({ lemmaA: 'known' })
    })
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>()

    await resolveKnownLevels(bridge, dispatch, [tokenA, tokenB], cache)
    await resolveKnownLevels(bridge, dispatch, [tokenB], cache)

    expect(bridge.levelsFor).toHaveBeenCalledTimes(1)
    expect(cache).toEqual(
      new Map([
        ['lemmaA', 'known'],
        ['lemmaB', 'unknown']
      ])
    )
    expect(dispatch).toHaveBeenCalledWith({
      type: 'knownLevelsLoaded',
      levels: { lemmaA: 'known', lemmaB: 'unknown' }
    })
  })

  it('uses a differing surface level when the lemma is absent', async () => {
    const bridge = makeKnowledgeBridge({
      levelsFor: vi.fn().mockResolvedValue({ surfaceA: 'known' })
    })
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>()
    const surfaceToken: Token = { ...tokenA, surface: 'surfaceA' }

    await resolveKnownLevels(bridge, dispatch, [surfaceToken], cache)

    expect(bridge.levelsFor).toHaveBeenCalledWith(['lemmaA', 'surfaceA'])
    expect(cache.get('lemmaA')).toBe('known')
  })

  it('keeps the higher level when both lemma and surface have rows', async () => {
    const bridge = makeKnowledgeBridge({
      levelsFor: vi.fn().mockResolvedValue({ lemmaA: 'learning', surfaceA: 'wellKnown' })
    })
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>()

    await resolveKnownLevels(bridge, dispatch, [{ ...tokenA, surface: 'surfaceA' }], cache)

    expect(cache.get('lemmaA')).toBe('wellKnown')
  })

  it('a stale (superseded) request neither dispatches nor populates the cache', async () => {
    const first = deferred<Record<string, KnowledgeLevel>>()
    const levelsFor = vi.fn().mockReturnValue(first.promise)
    const bridge: KnowledgeBridge = { levelsFor }
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>()
    const token: SubtitleRequestToken = { current: 0 }

    const call = resolveKnownLevels(bridge, dispatch, [tokenA], cache, token)
    // Supersede before the bridge call resolves.
    token.current++
    first.resolve({ lemmaA: 'known' })
    await call

    expect(dispatch).not.toHaveBeenCalled()
    expect(cache.has('lemmaA')).toBe(false)
  })
})

// These two functions back App.tsx's word-hover/word-click -> WordPopup
// flow (see App.tsx's showWordPopup). Extracted here — same "injected
// bridge, no DOM/Electron" shape as every other function in this file — so
// that flow is actually unit-tested, per AGENTS.md law #2: previously it
// lived entirely inline inside App.tsx's component closure, untestable
// without a live DOM.

describe('tokenizeAllCues', () => {
  const cueA: Cue = { start: 0, end: 1, text: '猫' }
  const cueB: Cue = { start: 1, end: 2, text: '犬' }
  const tokenCat: Token = {
    surface: '猫',
    reading: 'ネコ',
    lemma: '猫',
    pos: '名詞',
    startOffset: 0
  }
  const tokenDog: Token = {
    surface: '犬',
    reading: 'イヌ',
    lemma: '犬',
    pos: '名詞',
    startOffset: 0
  }

  function makeMecabBatch(batches: Token[][]): MecabBatchBridge {
    return { tokenizeBatch: vi.fn().mockResolvedValue(batches) }
  }
  function makeKnowledge(levels: Record<string, KnowledgeLevel>): KnowledgeBridge {
    return { levelsFor: vi.fn().mockResolvedValue(levels) }
  }

  it('empty cues: returns and dispatches an empty token map, batches nothing, resolves no levels', async () => {
    const mecab = makeMecabBatch([])
    const knowledge = makeKnowledge({})
    const dispatch = vi.fn()

    const snapshot = await tokenizeAllCues(mecab, knowledge, dispatch, [], new Map(), new Map())

    expect(snapshot).toEqual({})
    expect(mecab.tokenizeBatch).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({ type: 'allCueTokensLoaded', tokens: {} })
    expect(knowledge.levelsFor).not.toHaveBeenCalled()
  })

  it('batch-tokenizes cache-miss cues, returns the complete snapshot, dispatches the map, and resolves all levels', async () => {
    const mecab = makeMecabBatch([[tokenCat], [tokenDog]])
    const knowledge = makeKnowledge({ 猫: 'known', 犬: 'unknown' })
    const dispatch = vi.fn()
    const tokenCache = new Map<string, Token[]>()

    const snapshot = await tokenizeAllCues(
      mecab,
      knowledge,
      dispatch,
      [cueA, cueB],
      tokenCache,
      new Map()
    )

    expect(snapshot).toEqual({ [cueKey(cueA)]: [tokenCat], [cueKey(cueB)]: [tokenDog] })
    expect(mecab.tokenizeBatch).toHaveBeenCalledWith(['猫', '犬'])
    expect(tokenCache.get(cueKey(cueA))).toEqual([tokenCat])
    expect(tokenCache.get(cueKey(cueB))).toEqual([tokenDog])
    expect(dispatch).toHaveBeenCalledWith({
      type: 'allCueTokensLoaded',
      tokens: { [cueKey(cueA)]: [tokenCat], [cueKey(cueB)]: [tokenDog] }
    })
    expect(knowledge.levelsFor).toHaveBeenCalledWith(['猫', '犬'])
  })

  it('one cache miss publishes one new complete snapshot while reusing cached cue arrays', async () => {
    const mecab = makeMecabBatch([[tokenDog]])
    const knowledge = makeKnowledge({ 犬: 'unknown' })
    const dispatch = vi.fn()
    const tokenCache = new Map<string, Token[]>([[cueKey(cueA), [tokenCat]]])

    await tokenizeAllCues(mecab, knowledge, dispatch, [cueA, cueB], tokenCache, new Map())

    // Only the uncached cueB is batched.
    expect(mecab.tokenizeBatch).toHaveBeenCalledWith(['犬'])
    expect(dispatch).toHaveBeenCalledWith({
      type: 'allCueTokensLoaded',
      tokens: { [cueKey(cueA)]: [tokenCat], [cueKey(cueB)]: [tokenDog] }
    })
  })

  it('a repeat with the same caches returns the complete snapshot without tokenizing or refreshing knowledge', async () => {
    const mecab = makeMecabBatch([])
    const knowledge = makeKnowledge({})
    const dispatch = vi.fn()
    const tokenCache = new Map<string, Token[]>([
      [cueKey(cueA), [tokenCat]],
      [cueKey(cueB), [tokenDog]]
    ])
    const knownLevelsCache = new Map<string, KnowledgeLevel>([
      [tokenCat.lemma, 'known'],
      [tokenDog.lemma, 'unknown']
    ])

    const snapshot = await tokenizeAllCues(
      mecab,
      knowledge,
      dispatch,
      [cueA, cueB],
      tokenCache,
      knownLevelsCache
    )

    expect(snapshot).toEqual({ [cueKey(cueA)]: [tokenCat], [cueKey(cueB)]: [tokenDog] })
    expect(mecab.tokenizeBatch).not.toHaveBeenCalled()
    expect(knowledge.levelsFor).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('stale request (a newer call bumped the token) neither dispatches nor resolves levels', async () => {
    const pending = deferred<Token[][]>()
    const mecab: MecabBatchBridge = { tokenizeBatch: vi.fn().mockReturnValue(pending.promise) }
    const knowledge = makeKnowledge({ 猫: 'known' })
    const dispatch = vi.fn()
    const token: SubtitleRequestToken = { current: 0 }

    const call = tokenizeAllCues(mecab, knowledge, dispatch, [cueA], new Map(), new Map(), token)
    token.current++ // a newer request starts before the batch resolves
    pending.resolve([[tokenCat]])
    expect(await call).toBeUndefined()

    expect(dispatch).not.toHaveBeenCalled()
    expect(knowledge.levelsFor).not.toHaveBeenCalled()
  })
})
