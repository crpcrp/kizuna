import { describe, it, expect, vi } from 'vitest'
import {
  type DictLookupBridge,
  buildLongestMatchCandidates,
  lookupLinkedWord,
  lookupWordPopup,
  matchedTokenSpan,
  resolvePopupHighlightSpan,
  wordPopupPosition
} from '@src/renderer/src/state/wordLookup'
import { type LookupResult } from '@src/shared/dictionary'
import { type Token } from '@src/shared/token'

describe('wordPopupPosition', () => {
  it('anchors at the subtitle box’s horizontal center / top when a rect is given', () => {
    const rect = { left: 100, top: 50, width: 40 }
    expect(wordPopupPosition(rect)).toEqual({ x: 120, y: 50 })
  })

  it('prefers the subtitle rect over the event when both are given', () => {
    const rect = { left: 100, top: 50, width: 40 }
    const event = { clientX: 999, clientY: 999 }
    expect(wordPopupPosition(rect, event)).toEqual({ x: 120, y: 50 })
  })

  it('falls back to the event coordinates when there is no rect', () => {
    const event = { clientX: 12, clientY: 34 }
    expect(wordPopupPosition(undefined, event)).toEqual({ x: 12, y: 34 })
  })

  it('falls back to {0,0} when neither a rect nor an event is given', () => {
    expect(wordPopupPosition(undefined)).toEqual({ x: 0, y: 0 })
  })
})

describe('lookupWordPopup', () => {
  const token: Token = { surface: '猫', reading: 'ねこ', lemma: '猫', pos: '名詞', startOffset: 0 }
  const result: LookupResult = {
    expression: '猫',
    reading: 'ねこ',
    glossary: 'cat',
    dictTitle: 'JMdict',
    dictId: 1,
    stylesCss: null,
    frequency: null,
    frequencyDisplay: null,
    pitchAccent: null,
    defTags: '',
    termTags: '',
    score: 0,
    rules: ''
  }

  function makeDictBridge(): DictLookupBridge {
    return { lookup: vi.fn().mockResolvedValue([result]) }
  }

  it('looks up by lemma/reading and resolves { results, position }', async () => {
    const bridge = makeDictBridge()
    const position = { x: 1, y: 2 }

    const popup = await lookupWordPopup(bridge, token, position, null)

    expect(bridge.lookup).toHaveBeenCalledWith('猫', 'ねこ', null, undefined, undefined, '猫')
    expect(popup).toEqual({ results: [result], position, highlightedTokens: [token] })
  })

  it('passes the reading as undefined (not empty string) when the token has none', async () => {
    const bridge = makeDictBridge()
    const tokenNoReading: Token = { ...token, reading: '' }

    await lookupWordPopup(bridge, tokenNoReading, { x: 0, y: 0 }, 5)

    expect(bridge.lookup).toHaveBeenCalledWith('猫', undefined, 5, undefined, undefined, '猫')
  })

  it('forwards the frequency dict id through to the bridge', async () => {
    const bridge = makeDictBridge()

    await lookupWordPopup(bridge, token, { x: 0, y: 0 }, 7)

    expect(bridge.lookup).toHaveBeenCalledWith('猫', 'ねこ', 7, undefined, undefined, '猫')
  })

  it('omits the sort-mode override when sortOrder is "auto"', async () => {
    const bridge = makeDictBridge()

    await lookupWordPopup(bridge, token, { x: 0, y: 0 }, 7, 'auto')

    expect(bridge.lookup).toHaveBeenCalledWith('猫', 'ねこ', 7, undefined, undefined, '猫')
  })

  it('forwards an explicit sortOrder override to the bridge', async () => {
    const bridge = makeDictBridge()

    await lookupWordPopup(bridge, token, { x: 0, y: 0 }, 7, 'occurrence-based')

    expect(bridge.lookup).toHaveBeenCalledWith('猫', 'ねこ', 7, 'occurrence-based', undefined, '猫')
  })

  it('forwards token-boundary and clicked-token prefix candidates longest first', async () => {
    const bridge = makeDictBridge()
    const enma: Token = {
      surface: '閻魔',
      reading: 'えんま',
      lemma: '閻魔',
      pos: '名詞',
      startOffset: 1
    }
    const daiou: Token = {
      surface: '大王',
      reading: 'だいおう',
      lemma: '大王',
      pos: '名詞',
      startOffset: 3
    }
    const cueTokens = [enma, daiou]

    await lookupWordPopup(bridge, enma, { x: 0, y: 0 }, null, undefined, cueTokens)

    expect(bridge.lookup).toHaveBeenCalledWith(
      '閻魔',
      'えんま',
      null,
      undefined,
      ['閻魔大王', '閻魔', '閻'],
      '閻魔'
    )
  })

  it('includes a differing clicked surface after existing compound candidates', async () => {
    const bridge = makeDictBridge()
    const goku: Token = {
      surface: '悟空',
      reading: 'ゴクー',
      lemma: 'ゴクウ',
      pos: '名詞',
      startOffset: 0
    }
    const next: Token = {
      surface: '様',
      reading: 'サマ',
      lemma: '様',
      pos: '接尾辞',
      startOffset: 2
    }

    await lookupWordPopup(bridge, goku, { x: 0, y: 0 }, null, undefined, [goku, next])

    expect(bridge.lookup).toHaveBeenCalledWith(
      'ゴクウ',
      'ゴクー',
      null,
      undefined,
      ['悟空様', '悟空', '悟'],
      '悟空'
    )
  })

  it('queries JPDBv2’s exact 良かろう headword when MeCab supplies a different lemma', async () => {
    const bridge = makeDictBridge()
    const yokarou: Token = {
      surface: '良かろう',
      reading: 'よかろう',
      lemma: '良い',
      pos: '形容詞',
      startOffset: 0
    }

    await lookupWordPopup(bridge, yokarou, { x: 0, y: 0 }, null, undefined, [yokarou])

    expect(bridge.lookup).toHaveBeenCalledWith(
      '良い',
      'よかろう',
      null,
      undefined,
      ['良かろう', '良かろ', '良か', '良'],
      '良かろう'
    )
  })

  it('forwards the clicked token when it has no siblings to merge with', async () => {
    const bridge = makeDictBridge()

    await lookupWordPopup(bridge, token, { x: 0, y: 0 }, null, undefined, [token])

    expect(bridge.lookup).toHaveBeenCalledWith('猫', 'ねこ', null, undefined, ['猫'], '猫')
  })

  it('does not offer internal prefixes for an inflected single-token form', async () => {
    const bridge = makeDictBridge()
    const ikitakereba: Token = {
      surface: '行きたければ',
      reading: 'イキタケレバ',
      lemma: '行く',
      pos: '動詞',
      startOffset: 0
    }

    await lookupWordPopup(bridge, ikitakereba, { x: 0, y: 0 }, null, undefined, [ikitakereba])

    expect(bridge.lookup).toHaveBeenCalledWith(
      '行く',
      'イキタケレバ',
      null,
      undefined,
      ['行きたければ'],
      '行きたければ'
    )
  })

  it('highlights the full compound span when the resolved expression is a longest-match hit', async () => {
    const enma: Token = {
      surface: '閻魔',
      reading: 'えんま',
      lemma: '閻魔',
      pos: '名詞',
      startOffset: 1
    }
    const daiou: Token = {
      surface: '大王',
      reading: 'だいおう',
      lemma: '大王',
      pos: '名詞',
      startOffset: 3
    }
    const cueTokens = [enma, daiou]
    const compoundResult: LookupResult = { ...result, expression: '閻魔大王' }
    const bridge: DictLookupBridge = { lookup: vi.fn().mockResolvedValue([compoundResult]) }

    const popup = await lookupWordPopup(bridge, enma, { x: 0, y: 0 }, null, undefined, cueTokens)

    expect(popup.highlightedTokens).toEqual([enma, daiou])
  })

  it('highlights all of がよい when the dictionary result uses the が良い spelling', async () => {
    const ga: Token = { surface: 'が', reading: 'が', lemma: 'が', pos: '助詞', startOffset: 0 }
    const yoi: Token = {
      surface: 'よい',
      reading: 'よい',
      lemma: '良い',
      pos: '形容詞',
      startOffset: 1
    }
    const orthographicResult: LookupResult = { ...result, expression: 'が良い' }
    const bridge: DictLookupBridge = { lookup: vi.fn().mockResolvedValue([orthographicResult]) }

    const popup = await lookupWordPopup(bridge, ga, { x: 0, y: 0 }, null, undefined, [ga, yoi])

    expect(popup.highlightedTokens).toEqual([ga, yoi])
  })

  it('highlights just the clicked token when the resolved expression is not a compound (e.g. deinflection)', async () => {
    const tabeta: Token = {
      surface: '食べた',
      reading: 'たべた',
      lemma: '食べた',
      pos: '動詞',
      startOffset: 0
    }
    const deinflectedResult: LookupResult = { ...result, expression: '食べる' }
    const bridge: DictLookupBridge = { lookup: vi.fn().mockResolvedValue([deinflectedResult]) }

    const popup = await lookupWordPopup(bridge, tabeta, { x: 0, y: 0 }, null, undefined, [tabeta])

    expect(popup.highlightedTokens).toEqual([tabeta])
  })

  it('highlights just the clicked token when there are no results', async () => {
    const bridge: DictLookupBridge = { lookup: vi.fn().mockResolvedValue([]) }

    const popup = await lookupWordPopup(bridge, token, { x: 0, y: 0 }, null)

    expect(popup.highlightedTokens).toEqual([token])
  })
})

describe('lookupLinkedWord', () => {
  const result: LookupResult = {
    expression: '閻魔',
    reading: 'えんま',
    glossary: 'Yama (king of hell)',
    dictTitle: 'JMdict',
    dictId: 1,
    stylesCss: null,
    frequency: null,
    frequencyDisplay: null,
    pitchAccent: null,
    defTags: '',
    termTags: '',
    score: 0,
    rules: ''
  }

  function makeDictBridge(): DictLookupBridge {
    return { lookup: vi.fn().mockResolvedValue([result]) }
  }

  it('looks up the given expression directly, with no reading or candidates', async () => {
    const bridge = makeDictBridge()

    const results = await lookupLinkedWord(bridge, '閻魔', null)

    expect(bridge.lookup).toHaveBeenCalledWith('閻魔', undefined, null, undefined)
    expect(results).toEqual([result])
  })

  it('forwards the frequency dict id through to the bridge', async () => {
    const bridge = makeDictBridge()

    await lookupLinkedWord(bridge, '閻魔', 7)

    expect(bridge.lookup).toHaveBeenCalledWith('閻魔', undefined, 7, undefined)
  })

  it('omits the sort-mode override when sortOrder is "auto"', async () => {
    const bridge = makeDictBridge()

    await lookupLinkedWord(bridge, '閻魔', 7, 'auto')

    expect(bridge.lookup).toHaveBeenCalledWith('閻魔', undefined, 7, undefined)
  })

  it('forwards an explicit sortOrder override to the bridge', async () => {
    const bridge = makeDictBridge()

    await lookupLinkedWord(bridge, '閻魔', 7, 'occurrence-based')

    expect(bridge.lookup).toHaveBeenCalledWith('閻魔', undefined, 7, 'occurrence-based')
  })
})

describe('matchedTokenSpan', () => {
  const enma: Token = {
    surface: '閻魔',
    reading: 'えんま',
    lemma: '閻魔',
    pos: '名詞',
    startOffset: 1
  }
  const daiou: Token = {
    surface: '大王',
    reading: 'だいおう',
    lemma: '大王',
    pos: '名詞',
    startOffset: 3
  }
  const un: Token = {
    surface: 'うん',
    reading: 'うん',
    lemma: 'うん',
    pos: '感動詞',
    startOffset: 5
  }

  it('returns the run of tokens whose merged surface equals the expression', () => {
    expect(matchedTokenSpan([enma, daiou, un], enma, '閻魔大王')).toEqual([enma, daiou])
  })

  it('returns just the clicked token when the expression equals its own surface', () => {
    expect(matchedTokenSpan([enma, daiou, un], enma, '閻魔')).toEqual([enma])
  })

  it('falls back to [clickedToken] when no prefix run matches the expression', () => {
    expect(matchedTokenSpan([enma, daiou, un], enma, '食べる')).toEqual([enma])
  })

  it('falls back to [clickedToken] when clickedToken is not found in cueTokens', () => {
    const stray: Token = {
      surface: '猫',
      reading: 'ねこ',
      lemma: '猫',
      pos: '名詞',
      startOffset: 99
    }
    expect(matchedTokenSpan([enma, daiou], stray, '猫')).toEqual([stray])
  })
})

describe('resolvePopupHighlightSpan', () => {
  const token = (surface: string, lemma: string, pos: string, startOffset: number): Token => ({
    surface,
    lemma,
    pos,
    startOffset,
    reading: ''
  })

  it('extends a split compound-verb inflection through たり but not terminal ね', () => {
    const tokens = [
      token('生き', '生きる', '動詞', 0),
      token('返っ', '返る', '動詞', 2),
      token('たり', 'たり', '助詞', 4),
      token('ね', 'ね', '助詞', 6)
    ]

    expect(resolvePopupHighlightSpan(tokens, tokens[0], { expression: '生き返る' })).toEqual(
      tokens.slice(0, 3)
    )
  })

  it('does not absorb a new verb after a conjunction suffix closes the inflection', () => {
    const tokens = [
      token('生き', '生きる', '動詞', 0),
      token('返っ', '返る', '動詞', 2),
      token('て', 'て', '助詞', 4),
      token('行く', '行く', '動詞', 5)
    ]

    expect(resolvePopupHighlightSpan(tokens, tokens[0], { expression: '生き返る' })).toEqual(
      tokens.slice(0, 3)
    )
  })

  it('does not absorb a second additional main verb before any suffix', () => {
    const tokens = [
      token('生き', '生きる', '動詞', 0),
      token('返り', '返る', '動詞', 2),
      token('始める', '始める', '動詞', 4)
    ]

    expect(resolvePopupHighlightSpan(tokens, tokens[0], { expression: '生き返る' })).toEqual(
      tokens.slice(0, 2)
    )
  })

  it('extends a split expression through an inflected verb and そう only', () => {
    const tokens = [
      token('何', '何', '名詞', 0),
      token('と', 'と', '助詞', 1),
      token('か', 'か', '助詞', 2),
      token('なり', 'なる', '動詞', 3),
      token('そう', 'そう', '名詞', 5),
      token('ね', 'ね', '助詞', 7)
    ]

    expect(resolvePopupHighlightSpan(tokens, tokens[0], { expression: '何とかなる' })).toEqual(
      tokens.slice(0, 5)
    )
  })

  it('keeps an ordinary exact single-word result to the clicked token', () => {
    const tokens = [token('生き', '生きる', '動詞', 0), token('返っ', '返る', '動詞', 2)]

    expect(resolvePopupHighlightSpan(tokens, tokens[0], { expression: '生きる' })).toEqual([
      tokens[0]
    ])
  })

  it('trusts an exact multi-token matched surface and excludes following punctuation', () => {
    const tokens = [
      token('何', '何', '名詞', 0),
      token('とか', 'とか', '副詞', 1),
      token('。', '。', '記号', 3)
    ]

    expect(
      resolvePopupHighlightSpan(tokens, tokens[0], {
        expression: '何とか',
        matchedSurface: '何とか'
      })
    ).toEqual(tokens.slice(0, 2))
  })
})

describe('buildLongestMatchCandidates', () => {
  const enma: Token = {
    surface: '閻魔',
    reading: 'えんま',
    lemma: '閻魔',
    pos: '名詞',
    startOffset: 1
  }
  const daiou: Token = {
    surface: '大王',
    reading: 'だいおう',
    lemma: '大王',
    pos: '名詞',
    startOffset: 3
  }
  const un: Token = {
    surface: 'うん',
    reading: 'うん',
    lemma: 'うん',
    pos: '感動詞',
    startOffset: 5
  }

  it('merges surfaces and then adds shorter clicked-token prefixes, longest first', () => {
    expect(buildLongestMatchCandidates([enma, daiou, un], enma)).toEqual([
      '閻魔大王うん',
      '閻魔大王',
      '閻魔',
      '閻'
    ])
  })

  it('only merges tokens starting at the clicked token, not before it', () => {
    expect(buildLongestMatchCandidates([enma, daiou, un], daiou)).toEqual([
      '大王うん',
      '大王',
      '大'
    ])
  })

  it('includes the clicked token when it is the last token', () => {
    expect(buildLongestMatchCandidates([enma, daiou, un], un)).toEqual(['うん', 'う'])
  })

  it('returns [] when the clicked token is not found in cueTokens', () => {
    const stray: Token = {
      surface: '猫',
      reading: 'ねこ',
      lemma: '猫',
      pos: '名詞',
      startOffset: 99
    }
    expect(buildLongestMatchCandidates([enma, daiou], stray)).toEqual([])
  })

  it('returns [] for an empty cueTokens array', () => {
    expect(buildLongestMatchCandidates([], enma)).toEqual([])
  })

  it('caps the merge window at maxTokens', () => {
    const tokens = ['あ', 'い', 'う', 'え', 'お'].map((surface, i): Token => ({
      surface,
      reading: surface,
      lemma: surface,
      pos: '名詞',
      startOffset: i
    }))
    expect(buildLongestMatchCandidates(tokens, tokens[0], 3)).toEqual(['あいう', 'あい', 'あ'])
  })

  it('does not split a supplementary Unicode character while generating prefixes', () => {
    const token: Token = {
      surface: '𠮷野',
      reading: 'よしの',
      lemma: '𠮷野',
      pos: '名詞',
      startOffset: 0
    }

    expect(buildLongestMatchCandidates([token], token)).toEqual(['𠮷野', '𠮷'])
  })

  it('adds a final-token lemma variant for multi-token spans but not the clicked token alone', () => {
    const nantoka: Token = {
      surface: '何とか',
      reading: 'なんとか',
      lemma: '何とか',
      pos: '副詞',
      startOffset: 0
    }
    const nari: Token = {
      surface: 'なり',
      reading: 'なり',
      lemma: 'なる',
      pos: '動詞',
      startOffset: 3
    }
    const sou: Token = {
      surface: 'そう',
      reading: 'そう',
      lemma: 'そう',
      pos: '名詞',
      startOffset: 5
    }

    expect(buildLongestMatchCandidates([nantoka, nari, sou], nantoka)).toEqual([
      '何とかなりそう',
      '何とかなり',
      '何とかなる',
      '何とか',
      '何と',
      '何'
    ])
  })

  it('does not add a single-token lemma variant', () => {
    const tabeta: Token = {
      surface: '食べた',
      reading: 'たべた',
      lemma: '食べる',
      pos: '動詞',
      startOffset: 0
    }

    expect(buildLongestMatchCandidates([tabeta], tabeta)).toEqual(['食べた', '食べ', '食'])
  })
})
