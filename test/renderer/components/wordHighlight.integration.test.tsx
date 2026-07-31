import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseMecab } from '@src/main/services/mecab/parseMecab'
import { lookup } from '@src/main/services/dict/lookup'
import type { LookupDb } from '@src/main/services/dict/lookupDb'
import SubtitleOverlay from '@src/renderer/src/components/SubtitleOverlay'
import { CueRowContent } from '@src/renderer/src/components/SubtitleSidebar'
import { cueKey } from '@src/renderer/src/state/tokenization'
import { type DictLookupBridge, lookupWordPopup } from '@src/renderer/src/state/wordLookup'
import type { Token } from '@src/shared/token'
import { createVocabularySpanController } from '@src/renderer/src/state/vocabularySpanController'
import type { LookupResult } from '@src/shared/dictionary'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { makeToken } from '@test/harness/tokenFixtures'

const ROWS = ['生き返る', '生き', '何とかなる', '何とか', '行きたければ', '行き'].map(
  (expression, index) => ({
    expression,
    reading: expression,
    glossary: expression,
    glossary_json: null,
    title: 'Fake Dict',
    dict_id: index + 1,
    styles_css: null,
    def_tags: null,
    term_tags: null,
    rules: null,
    score: 0
  })
)

const db: LookupDb = {
  exec() {
    return undefined
  },
  prepare(sql) {
    return {
      all(...params: unknown[]) {
        if (sql.includes('FROM term_meta')) return []
        if (sql.includes('frequency_mode')) return [{ frequency_mode: 'rank-based' }]
        const queries = new Set(
          params.filter((value): value is string => typeof value === 'string')
        )
        return ROWS.filter((row) => queries.has(row.expression) || queries.has(row.reading))
      }
    }
  }
}

const bridge: DictLookupBridge = {
  lookup(lemma, reading, freqDictId, sortMode, longestMatchCandidates, surface) {
    return Promise.resolve(
      lookup(db, { lemma, reading, longestMatchCandidates, surface }, { freqDictId, sortMode })
    )
  }
}

const cases = [
  {
    phrase: '生き返ったり',
    stdout: [
      '生き\t動詞,自立,*,*,一段,連用形,生きる,イキ,イキ',
      '返っ\t動詞,自立,*,*,五段・ラ行,連用タ接続,返る,カエッ,カエッ',
      'たり\t助詞,接続助詞,*,*,*,*,たり,タリ,タリ',
      'ね\t助詞,終助詞,*,*,*,*,ね,ネ,ネ',
      'EOS'
    ].join('\n')
  },
  {
    phrase: '何とかなりそう',
    stdout: [
      '何\t名詞,代名詞,一般,*,*,*,何,ナニ,ナニ',
      'と\t助詞,格助詞,一般,*,*,*,と,ト,ト',
      'か\t助詞,副助詞／並立助詞／終助詞,*,*,*,*,か,カ,カ',
      'なり\t動詞,自立,*,*,五段・ラ行,連用形,なる,ナリ,ナリ',
      'そう\t名詞,接尾,助動詞語幹,*,*,*,そう,ソウ,ソー',
      'ね\t助詞,終助詞,*,*,*,*,ね,ネ,ネ',
      'EOS'
    ].join('\n')
  },
  {
    phrase: '行きたければ',
    stdout: [
      '行きたけれ\t動詞,自立,*,*,五段・カ行イ音便,仮定形,行く,イキタケレ,イキタケレ',
      'ば\t助詞,接続助詞,*,*,*,*,ば,バ,バ',
      'ね\t助詞,終助詞,*,*,*,*,ね,ネ,ネ',
      'EOS'
    ].join('\n')
  }
]

describe('word popup highlight production path', () => {
  it.each(cases)(
    'highlights all of $phrase and excludes its trailing particle',
    async ({ phrase, stdout }) => {
      const tokens = parseMecab('ipadic', stdout)
      const popup = await lookupWordPopup(
        bridge,
        tokens[0],
        { x: 0, y: 0 },
        null,
        undefined,
        tokens
      )
      const html = renderToStaticMarkup(
        <SubtitleOverlay
          cues={[{ start: 0, end: 1, text: `${phrase}ね` }]}
          timePos={0.5}
          tokens={tokens}
          highlightedTokens={popup.highlightedTokens}
        />
      )

      const expectedExpression =
        phrase === '生き返ったり'
          ? '生き返る'
          : phrase === '何とかなりそう'
            ? '何とかなる'
            : '行きたければ'
      expect(popup.results[0]?.expression).toBe(expectedExpression)
      expect(html.match(/data-highlighted=""/g)).toHaveLength(tokens.length - 1)
      expect(html).toContain(`data-highlighted="">${tokens.at(-2)?.surface}</span>`)
      expect(html).toContain(`<span data-token="">ね</span>`)
    }
  )
})

describe('compound knowledge projection rendering', () => {
  const cue = { start: 0, end: 1, text: '神様と様' }
  const otherCue = { start: 2, end: 3, text: '様' }
  const tokens: Token[] = [
    makeToken({ surface: '神', reading: 'かみ' }),
    makeToken({ surface: '様', reading: 'さま', startOffset: 1 }),
    makeToken({ surface: 'と', reading: 'と', pos: '助詞', startOffset: 2 }),
    makeToken({ surface: '様', reading: 'さま', startOffset: 3 })
  ]
  async function resolvedSpans() {
    const compound: LookupResult = makeLookupResult({
      expression: '神様',
      matchedSurface: '神様',
      reading: '神様',
      glossary: '',
      dictTitle: 'Fake Dict'
    })
    const result = await createVocabularySpanController().resolve({
      dict: { lookup: (lemma) => Promise.resolve(lemma === '神' ? [compound] : []) },
      knowledge: { detailsFor: () => Promise.resolve({ 神様: { level: 'known', sources: [] } }) },
      cues: [{ cueKey: cueKey(cue), tokens }],
      frequencyDictId: null,
      epoch: { file: 1, track: 1, tokenization: 1, dictionary: 1, knowledge: 1 }
    })
    return result.kind === 'resolved' ? result.spansByCue[cueKey(cue)] : []
  }

  it('projects resolver output only onto the known compound while keeping popup highlighting independent', async () => {
    const spans = await resolvedSpans()
    const html = renderToStaticMarkup(
      <SubtitleOverlay
        cues={[cue]}
        timePos={0.5}
        tokens={tokens}
        levels={{ 神: 'unknown', 様: 'unknown' }}
        vocabularySpans={spans}
        highlightedTokens={tokens.slice(0, 2)}
      />
    )

    expect(html.match(/data-level="known"/g)).toHaveLength(2)
    expect(html).toContain('data-highlighted="" data-level="known">神</span>')
    expect(html).toContain('data-highlighted="" data-level="known">様</span>')
    expect(html).toContain('data-level="unknown">様</span>')
    expect(html).not.toContain('data-highlighted="" data-level="unknown"')
  })

  it('keeps standalone 様 independent in the same and another cue, and disables all coloring without levels', async () => {
    const spans = await resolvedSpans()
    const sameCue = renderToStaticMarkup(
      <SubtitleOverlay
        cues={[cue]}
        timePos={0.5}
        tokens={tokens}
        levels={{}}
        vocabularySpans={spans}
      />
    )
    const standalone = renderToStaticMarkup(
      <SubtitleOverlay
        cues={[otherCue]}
        timePos={2.5}
        tokens={[{ ...tokens[1], startOffset: 0 }]}
        levels={{}}
        vocabularySpans={spans}
      />
    )
    const disabled = renderToStaticMarkup(
      <SubtitleOverlay cues={[cue]} timePos={0.5} tokens={tokens} vocabularySpans={spans} />
    )

    expect(sameCue).toContain('data-level="unknown">様</span>')
    expect(standalone).toContain('data-level="unknown">様</span>')
    expect(disabled).not.toContain('data-level=')
  })

  it('applies the same resolver output in sidebar rows without corrupting overlapping search marks', async () => {
    const spans = await resolvedSpans()
    const html = renderToStaticMarkup(
      <CueRowContent
        cue={cue}
        rowTokens={tokens}
        levels={{ 神: 'unknown', 様: 'unknown' }}
        vocabularySpans={spans}
        matches={[{ cueKey: cueKey(cue), start: 1, end: 3 }]}
        currentMatch={{ cueKey: cueKey(cue), start: 1, end: 3 }}
      />
    )

    expect(html).toContain('data-level="known"><mark data-current="">様</mark></span>')
    expect(html).toContain('data-level="wellKnown"><mark data-current="">と</mark></span>')
    expect(html).toContain('data-level="unknown">様</span>')
    expect(html).not.toContain('data-level="unknown">神</span>')
  })
})
