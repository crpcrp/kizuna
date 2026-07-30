import { describe, expect, it, vi } from 'vitest'
import type { Cue } from '@src/shared/cue'
import type { Token } from '@src/shared/token'
import { type SubtitleRequestToken } from '@src/renderer/src/state/mediaSession'
import { cueKey, tokenizeActiveCue } from '@src/renderer/src/state/tokenization'
import { invalidateTokenizationForDictionaryChange } from '@src/renderer/src/state/tokenizationInvalidation'

const cue: Cue = { start: 0, end: 1, text: '猫' }
const otherCue: Cue = { start: 1, end: 2, text: '犬' }
const oldTokens: Token[] = [
  { surface: '猫', reading: 'ネコ', lemma: 'old', pos: '名詞', startOffset: 0 }
]
const newTokens: Token[] = [
  { surface: '猫', reading: 'ねこ', lemma: 'new', pos: '名詞', startOffset: 0 }
]

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
    const cache = new Map<string, Token[]>()
    const activeToken: SubtitleRequestToken = { current: 0 }
    const stale = tokenizeActiveCue(mecab, dispatch, cue, cache, activeToken)

    const refreshed = invalidateTokenizationForDictionaryChange({
      mecab,
      knowledge: { levelsFor: vi.fn().mockResolvedValue({}) },
      dispatch,
      activeCue: cue,
      cues: [cue],
      sidebarOpen: false,
      tokenCache: cache,
      knownLevelsCache: new Map(),
      activeToken,
      allCuesToken: { current: 0 },
      allCuesLevelsToken: { current: 0 }
    })
    newResult.resolve(newTokens)
    await refreshed
    oldResult.resolve(oldTokens)
    await stale

    expect(dispatch).toHaveBeenCalledWith({ type: 'resetTokenization' })
    expect(cache.get(cueKey(cue))).toEqual(newTokens)
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
      tokenCache: new Map(),
      knownLevelsCache: new Map(),
      activeToken: { current: 0 },
      allCuesToken: { current: 0 },
      allCuesLevelsToken: { current: 0 }
    })

    expect(mecab.tokenizeBatch).toHaveBeenCalledWith(['犬'])
    expect(dispatch).toHaveBeenCalledWith({
      type: 'allCueTokensLoaded',
      tokens: { [cueKey(cue)]: newTokens, [cueKey(otherCue)]: newTokens }
    })
  })
})
