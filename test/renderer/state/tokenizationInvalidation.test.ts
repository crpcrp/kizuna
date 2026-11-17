import { deferred } from '@test/harness/deferred'
import { describe, expect, it, vi } from 'vitest'
import type { Cue } from '@src/shared/cue'
import type { Token } from '@src/shared/token'
import {
  createVocabularyCaches,
  cueKey,
  tokenizeActiveCue
} from '@src/renderer/src/state/tokenization'
import { invalidateTokenizationForDictionaryChange } from '@src/renderer/src/state/tokenizationInvalidation'
import { makeToken } from '@test/harness/tokenFixtures'

const cue: Cue = { start: 0, end: 1, text: '猫' }
const otherCue: Cue = { start: 1, end: 2, text: '犬' }
const oldTokens: Token[] = [makeToken({ surface: '猫', reading: 'ネコ', lemma: 'old' })]
const newTokens: Token[] = [makeToken({ surface: '猫', reading: 'ねこ', lemma: 'new' })]

describe('invalidateTokenizationForDictionaryChange', () => {
  it('clears tokens and ignores a late active-cue result from the previous dictionary', async () => {
    const oldResult = deferred<Token[]>()
    const newResult = deferred<Token[]>()
    const mecab = {
      tokenize: vi
        .fn()
        .mockReturnValueOnce(oldResult.promise)
        .mockReturnValueOnce(newResult.promise),
      tokenizeBatch: vi.fn()
    }
    const dispatch = vi.fn()
    const caches = createVocabularyCaches()
    const stale = tokenizeActiveCue(mecab, dispatch, cue, caches.tokenCache, caches.tokens.active)

    const refreshed = invalidateTokenizationForDictionaryChange({
      mecab,
      knowledge: { levelsFor: vi.fn().mockResolvedValue({ new: 'known' }) },
      dispatch,
      activeCue: cue,
      cues: [cue],
      sidebarOpen: false,
      caches
    })
    newResult.resolve(newTokens)
    await refreshed
    oldResult.resolve(oldTokens)
    await stale

    expect(dispatch).toHaveBeenCalledWith({ type: 'resetTokenization' })
    expect(caches.tokenCache.get(cueKey(cue))).toEqual(newTokens)
    expect(dispatch).toHaveBeenCalledWith({ type: 'knownLevelsLoaded', levels: { new: 'known' } })
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'activeTokensLoaded', tokens: oldTokens })
  })

  it('keeps the newer track when an older refresh finishes tokenizing its active cue', async () => {
    const pending = deferred<Token[]>()
    const mecab = {
      tokenize: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(newTokens),
      tokenizeBatch: vi.fn().mockResolvedValue([oldTokens])
    }
    const args = {
      mecab,
      knowledge: { levelsFor: vi.fn().mockResolvedValue({}) },
      dispatch: vi.fn(),
      sidebarOpen: true,
      caches: createVocabularyCaches()
    }
    const first = invalidateTokenizationForDictionaryChange({
      ...args,
      activeCue: cue,
      cues: [cue]
    })
    await invalidateTokenizationForDictionaryChange({
      ...args,
      activeCue: otherCue,
      cues: [otherCue]
    })
    args.dispatch.mockClear()
    pending.resolve(oldTokens)
    await first

    expect(args.dispatch).not.toHaveBeenCalled()
    expect(args.caches.tokenCache.has(cueKey(cue))).toBe(false)
    expect(mecab.tokenizeBatch).not.toHaveBeenCalled()
  })

  it('retokenizes the complete track when the sidebar is open', async () => {
    const mecab = {
      tokenize: vi.fn().mockResolvedValue(newTokens),
      tokenizeBatch: vi.fn().mockResolvedValue([newTokens])
    }
    const dispatch = vi.fn()

    await invalidateTokenizationForDictionaryChange({
      mecab,
      knowledge: { levelsFor: vi.fn().mockResolvedValue({}) },
      dispatch,
      activeCue: cue,
      cues: [cue, otherCue],
      sidebarOpen: true,
      caches: createVocabularyCaches()
    })

    expect(mecab.tokenizeBatch).toHaveBeenCalledWith(['犬'])
    expect(dispatch).toHaveBeenCalledWith({
      type: 'allCueTokensLoaded',
      tokens: { [cueKey(cue)]: newTokens, [cueKey(otherCue)]: newTokens }
    })
  })
})
