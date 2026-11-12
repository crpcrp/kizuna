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

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((done) => {
      resolve = done
    }),
    resolve
  }
}

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
      knowledge: { levelsFor: vi.fn().mockResolvedValue({}) },
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
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'activeTokensLoaded', tokens: oldTokens })
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
