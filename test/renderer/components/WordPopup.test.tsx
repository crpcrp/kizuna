// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import WordPopup from '@src/renderer/src/components/WordPopup'
import type { LookupResult } from '@src/shared/dictionary'
import type { KnowledgeDetails } from '@src/shared/knowledge'
import type { Token } from '@src/shared/token'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { makeToken } from '@test/harness/tokenFixtures'

function noop(): void {}

/** Finds the index right after the `</div>` that closes the div opened at `openTagStart`, by counting nested div open/close tags. */
function findMatchingDivClose(html: string, openTagStart: number): number {
  const tagRe = /<div\b|<\/div>/g
  tagRe.lastIndex = openTagStart
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(html))) {
    if (match[0] === '<div') depth++
    else depth--
    if (depth === 0) return tagRe.lastIndex
  }
  throw new Error('no matching </div> found')
}

function makeResult(overrides: Partial<LookupResult> = {}): LookupResult {
  return makeLookupResult({
    expression: '食べる',
    reading: 'たべる',
    glossary: 'to eat',
    dictTitle: 'Jitendex',
    ...overrides
  })
}

const sampleResults: LookupResult[] = [
  makeResult(),
  makeResult({
    expression: '食べ物',
    reading: 'たべもの',
    glossary: 'food; foodstuff',
    dictTitle: 'JMdict'
  })
]

function renderPopup(overrides: Partial<React.ComponentProps<typeof WordPopup>> = {}): string {
  return renderToStaticMarkup(
    <WordPopup results={sampleResults} position={{ x: 0, y: 0 }} onClose={noop} {...overrides} />
  )
}

describe('WordPopup markup', () => {
  it('renders generic provenance for missing or malformed source details', () => {
    for (const sources of [
      [],
      [
        { source: 'wanikani', proficiency: 4 },
        { source: 'anki', deck: 'Japanese', intervalDays: '21', cardId: 1, noteId: 2 }
      ]
    ]) {
      const provenance = {
        level: 'known',
        sourceKinds: ['anki', 'wanikani'],
        sources
      } as unknown as KnowledgeDetails
      const html = renderPopup({
        results: [makeResult()],
        provenanceByExpression: { 食べる: provenance }
      })
      expect(html).toContain('>WaniKani</span>')
      expect(html).toContain('>Anki</span>')
      expect(html.indexOf('>WaniKani</span>')).toBeLessThan(html.indexOf('>Anki</span>'))
      expect(html).not.toContain('Japanese')
    }
  })

  it('uses only authoritative sources and falls back independently per source', () => {
    const sources = [
      { source: 'wanikani' as const, proficiency: 'Guru II' },
      { source: 'anki' as const, deck: 'Ignored', intervalDays: 21, cardId: 1, noteId: 2 }
    ]
    const provenance: KnowledgeDetails = { level: 'known', sourceKinds: ['wanikani'], sources }
    const html = renderPopup({ provenanceByExpression: { 食べる: provenance } })
    expect(html).toContain('WaniKani - Guru II')
    expect(html).not.toContain('Ignored')
    expect(html).not.toContain('>Anki</span>')
    const mixed = renderPopup({
      provenanceByExpression: {
        食べる: { ...provenance, sourceKinds: ['anki', 'wanikani'], sources: sources.slice(0, 1) }
      }
    })
    expect(mixed).toContain('WaniKani - Guru II')
    expect(mixed).toContain('>Anki</span>')
    expect(provenance.sourceKinds).toEqual(['wanikani'])
    expect(sources).toHaveLength(2)
  })

  it('renders all WaniKani and Anki provenance badges directly below the headword', () => {
    const provenance: KnowledgeDetails = {
      level: 'known',
      sourceKinds: ['wanikani', 'anki'],
      sources: [
        { source: 'wanikani', curriculumLevel: 12, proficiency: 'Apprentice' },
        { source: 'anki', deck: 'Japanese', intervalDays: 21, cardId: 1, noteId: 2 },
        { source: 'anki', deck: 'Anime', intervalDays: 90, cardId: 3, noteId: 4 }
      ]
    }
    const html = renderPopup({
      results: [makeResult()],
      provenanceByExpression: { [makeResult().expression]: provenance }
    })

    expect(html).toContain('WaniKani - Level 12 - Apprentice')
    expect(html).toContain('Anki - Japanese - 21d')
    expect(html).toContain('Anki - Anime - 90d')
    expect(html.indexOf('word-popup-headword')).toBeLessThan(html.indexOf('word-popup-provenance'))
  })

  it('omits the provenance block when no source details exist', () => {
    const html = renderPopup({
      results: [makeResult()],
      provenanceByExpression: {
        [makeResult().expression]: { level: 'unknown', sourceKinds: [], sources: [] }
      }
    })

    expect(html).not.toContain('word-popup-provenance')
  })

  it('omits the WaniKani level segment when the curriculum level is unavailable', () => {
    const html = renderPopup({
      results: [makeResult()],
      provenanceByExpression: {
        [makeResult().expression]: {
          level: 'known',
          sourceKinds: ['wanikani'],
          sources: [{ source: 'wanikani', proficiency: 'Guru II' }]
        }
      }
    })

    expect(html).toContain('WaniKani - Guru II')
    expect(html).not.toContain('Level undefined')
  })

  it('renders an accessible approximate JLPT badge with the row metadata', () => {
    const result = makeResult({
      jlptLevel: 'N3',
      termTags: 'P',
      frequency: 12,
      frequencyDisplay: '12㋕',
      pitchAccent: [1]
    })
    const html = renderPopup({
      results: [result],
      onAddToAnki: noop,
      provenanceByExpression: {
        [result.expression]: {
          level: 'unknown',
          sourceKinds: ['wanikani'],
          sources: [{ source: 'wanikani', proficiency: 'Apprentice' }]
        }
      }
    })

    expect(html).toContain('JLPT N3 · approx.')
    expect(html).toContain('role="note"')
    expect(html).toContain('aria-label="Approximate JLPT vocabulary level: N3"')
    expect(html).toContain(
      'title="Community-sourced estimate; the JLPT does not publish official vocabulary lists."'
    )
    expect(html).toContain('word-popup-priority')
    expect(html).toContain('12㋕')
    expect(html).toContain('Pitch 1')
    expect(html).toContain('word-popup-dict-badge')
    expect(html).toContain('word-popup-anki-button')
    expect(html).toContain('WaniKani - Apprentice')

    expect(html.indexOf('word-popup-priority')).toBeLessThan(html.indexOf('word-popup-jlpt-level'))
    expect(html.indexOf('word-popup-jlpt-level')).toBeLessThan(html.indexOf('word-popup-frequency'))
    expect(html.indexOf('word-popup-frequency')).toBeLessThan(
      html.indexOf('word-popup-pitch-accent')
    )
    expect(html.indexOf('word-popup-pitch-accent')).toBeLessThan(
      html.indexOf('word-popup-dict-badge')
    )
  })

  it('renders each result level, including without provenance or with unknown knowledge', () => {
    const html = renderPopup({
      results: [
        makeResult({ expression: '猫', jlptLevel: 'N4' }),
        makeResult({ expression: '犬', jlptLevel: 'N2' }),
        makeResult({ expression: '鳥', jlptLevel: null })
      ],
      provenanceByExpression: {
        犬: { level: 'unknown', sourceKinds: [], sources: [] }
      }
    })

    expect(html).toContain('JLPT N4 · approx.')
    expect(html).toContain('JLPT N2 · approx.')
    expect(html.match(/class="word-popup-jlpt-level"/g) ?? []).toHaveLength(2)
    expect(html).not.toContain('JLPT N1')
    expect(html).not.toContain('JLPT N5')
  })

  it('does not duplicate a badge when rendered again with the same props', () => {
    const render = () => renderPopup({ results: [makeResult({ jlptLevel: 'N5' })] })

    expect(render().match(/class="word-popup-jlpt-level"/g) ?? []).toHaveLength(1)
    expect(render().match(/class="word-popup-jlpt-level"/g) ?? []).toHaveLength(1)
  })

  it('is present but hidden (no "open" class) when position is null', () => {
    const html = renderPopup({ position: null })
    expect(html).toContain('id="word-popup"')
    expect(html).not.toMatch(/id="word-popup"[^>]*\bopen\b/)
    expect(html).toContain('aria-hidden="true"')
  })

  it('adds the "open" class and drops aria-hidden when position is set', () => {
    const html = renderPopup({ position: { x: 10, y: 20 } })
    expect(html).toMatch(/id="word-popup"[^>]*class="word-popup open"/)
    expect(html).toContain('aria-hidden="false"')
  })

  it('renders an explicit empty-state message when position is set but results is empty', () => {
    const html = renderPopup({ results: [], position: { x: 10, y: 20 } })
    expect(html).toContain('No definition found')
    expect(html).not.toContain('word-popup-row')
  })

  it('renders one row per result with expression, reading, glossary, and dictTitle', () => {
    const html = renderPopup({ position: { x: 10, y: 20 } })
    const rowMatches = html.match(/data-testid="word-popup-row"/g) ?? []
    expect(rowMatches).toHaveLength(2)
    for (const result of sampleResults) {
      expect(html).toContain(result.expression)
      expect(html).toContain(result.reading)
      expect(html).toContain(result.glossary)
      expect(html).toContain(result.dictTitle)
    }
  })

  it('positions the popup using the position prop as inline left/top style', () => {
    const html = renderPopup({ position: { x: 123, y: 456 } })
    expect(html).toMatch(/id="word-popup"[^>]*style="left:123px;top:456px"/)
  })

  it('marks OCR placement so CSS can render an upper-screen box below its text', () => {
    const html = renderPopup({ position: { x: 123, y: 456, placement: 'below' } })
    expect(html).toContain('data-placement="below"')
  })

  it('renders the close button as a sibling of the scrollable panel, not nested inside it', () => {
    // The panel scrolls (overflow-y: auto in WordPopup.css); a close button
    // nested inside it would scroll out of view with the entry list. It must
    // stay outside .word-popup-panel so it's always clickable.
    const html = renderPopup({ position: { x: 10, y: 20 } })
    const panelClassIndex = html.indexOf('class="word-popup-panel"')
    const panelOpenStart = html.lastIndexOf('<div', panelClassIndex)
    const panelCloseEnd = findMatchingDivClose(html, panelOpenStart)
    const closeButtonIndex = html.indexOf('word-popup-close')
    expect(panelClassIndex).toBeGreaterThan(-1)
    expect(closeButtonIndex).toBeGreaterThan(panelCloseEnd)
  })

  it('renders furigana as ruby/rt when reading differs from expression', () => {
    const html = renderPopup({ results: [makeResult({ expression: '食べる', reading: 'たべる' })] })
    expect(html).toContain('<ruby>')
    expect(html).toMatch(/<rt[^>]*class="word-popup-furigana"[^>]*>たべる<\/rt>/)
  })

  it('omits furigana when reading equals expression or is empty', () => {
    const html = renderPopup({ results: [makeResult({ expression: 'ここ', reading: 'ここ' })] })
    expect(html).not.toContain('<ruby>')
  })

  it('shows a priority marker for a Jitendex definition-tag priority entry only', () => {
    const html = renderPopup({
      results: [
        makeResult({ termTags: '', defTags: '★ priority form' }),
        makeResult({ expression: '物', termTags: '', defTags: '' })
      ]
    })
    const priorityMatches = html.match(/word-popup-priority/g) ?? []
    expect(priorityMatches).toHaveLength(1)
  })

  it('shows frequency display text when frequency is present', () => {
    const html = renderPopup({ results: [makeResult({ frequency: 12, frequencyDisplay: '12㋕' })] })
    expect(html).toContain('word-popup-frequency')
    expect(html).toContain('12㋕')
  })

  it('falls back to the raw frequency number when frequencyDisplay is null', () => {
    const html = renderPopup({ results: [makeResult({ frequency: 42, frequencyDisplay: null })] })
    expect(html).toContain('>42<')
  })

  it("renders each result's pitch accent and omits empty metadata", () => {
    const html = renderPopup({
      results: [
        makeResult({ expression: '一つ', pitchAccent: [1] }),
        makeResult({ expression: '食べ物', pitchAccent: [1, 3] })
      ]
    })

    expect(html.match(/class="word-popup-pitch-accent"/g) ?? []).toHaveLength(2)
    const singlePitch = html.indexOf('aria-label="Pitch accent: 1"')
    const secondRow = html.indexOf('食べ物')
    const multiplePitch = html.indexOf('aria-label="Pitch accent: 1, 3"')
    expect(singlePitch).toBeGreaterThan(-1)
    expect(singlePitch).toBeLessThan(secondRow)
    expect(multiplePitch).toBeGreaterThan(secondRow)
    expect(html).toContain('Pitch 1, 3')

    const absent = renderPopup({
      results: [
        makeResult({ expression: '空', pitchAccent: null }),
        makeResult({ expression: '空っぽ', pitchAccent: [] })
      ]
    })
    expect(absent).not.toContain('word-popup-pitch-accent')
    expect(absent).not.toContain('Pitch accent:')
  })

  it('renders human-readable part-of-speech chips from rules/defTags', () => {
    const html = renderPopup({ results: [makeResult({ rules: 'v5r vt', defTags: 'v5r vt n' })] })
    expect(html).toContain('godan verb')
    expect(html).toContain('transitive')
    expect(html).toContain('noun')
  })

  it('splits multi-sense glossaries into one numbered badge per sense', () => {
    const html = renderPopup({ results: [makeResult({ glossary: ' here \n\n this place \n' })] })
    expect(html).toMatch(/word-popup-sense-number">1</)
    expect(html).toMatch(/word-popup-sense-number">2</)
    expect(html).toContain('here')
    expect(html).toContain('this place')
  })

  it('renders a single-sense glossary without a numbered badge', () => {
    const html = renderPopup({ results: [makeResult({ glossary: 'to eat' })] })
    expect(html).not.toContain('word-popup-sense-number')
    expect(html).toContain('to eat')
  })

  it('caps the number of rendered entries at maxEntries', () => {
    const html = renderPopup({ maxEntries: 1 })
    const rowMatches = html.match(/data-testid="word-popup-row"/g) ?? []
    expect(rowMatches).toHaveLength(1)
  })

  it('caps the number of rendered senses per entry at maxMeanings', () => {
    const html = renderPopup({
      results: [makeResult({ glossary: 'one\ntwo\nthree' })],
      maxMeanings: 2
    })
    expect(html).toContain('one')
    expect(html).toContain('two')
    expect(html).not.toContain('three')
  })

  it('caps nested structured glossary senses through the shared parser', () => {
    const glossaryJson = JSON.stringify([
      {
        type: 'structured-content',
        content: {
          tag: 'ol',
          content: [
            { tag: 'li', data: { content: 'sense' }, content: 'first sense' },
            { tag: 'li', data: { content: 'sense' }, content: 'second sense' },
            { tag: 'li', data: { content: 'sense' }, content: 'third sense' }
          ]
        }
      }
    ])
    const html = renderPopup({ results: [makeResult({ glossaryJson })], maxMeanings: 2 })

    expect(html).toContain('first sense')
    expect(html).toContain('second sense')
    expect(html).not.toContain('third sense')
  })

  it('keeps a resolved cross-reference definition visible at maxMeanings 1', () => {
    const glossaryJson = JSON.stringify([
      {
        type: 'structured-content',
        content: {
          tag: 'div',
          data: { content: 'kizuna-xref' },
          content: [
            {
              tag: 'div',
              data: { content: 'kizuna-xref-source' },
              content: [{ tag: 'a', href: '?query=王様', content: '王様' }]
            },
            {
              tag: 'div',
              data: { content: 'kizuna-xref-target' },
              content: 'resolved definition'
            }
          ]
        }
      }
    ])
    const html = renderPopup({
      results: [makeResult({ glossary: '→王様\nresolved definition', glossaryJson })],
      maxMeanings: 1
    })

    expect(html).toContain('resolved definition')
  })

  it('renders a rich structured-content glossary (list + styled note) instead of flattened text', () => {
    const glossaryJson = JSON.stringify([
      {
        type: 'structured-content',
        content: {
          tag: 'div',
          content: [
            {
              tag: 'ul',
              content: [
                { tag: 'li', content: 'such' },
                { tag: 'li', content: 'that kind of' }
              ]
            },
            {
              tag: 'div',
              style: { fontSize: '0.8em', backgroundColor: '#fff3cd' },
              content: 'about the actions of the listener'
            },
            { tag: 'a', href: '?query=あんな', content: 'あんな' },
            { tag: 'img', path: 'icon.png' }
          ]
        }
      }
    ])
    const html = renderPopup({ results: [makeResult({ glossaryJson })] })
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>such</li>')
    expect(html).toContain('<li>that kind of</li>')
    expect(html).toMatch(/style="[^"]*background-color:#fff3cd/)
    expect(html).toContain('about the actions of the listener')
    expect(html).toMatch(/class="word-popup-sc-link"[^>]*>あんな</)
    expect(html).not.toContain('icon.png')
  })

  it('renders only normalized safe styles from structured glossary content', () => {
    const glossaryJson = JSON.stringify([
      {
        type: 'structured-content',
        content: {
          tag: 'span',
          style: { color: 'red', backgroundImage: 'url(https://evil.example/x)' },
          content: 'safe text'
        }
      }
    ])
    const html = renderPopup({ results: [makeResult({ glossaryJson })] })
    expect(html).toContain('style="color:red"')
    expect(html).not.toContain('background-image')
  })

  it('renders a data-marked example-sentence node with a data-sc-content attribute', () => {
    const glossaryJson = JSON.stringify([
      {
        type: 'structured-content',
        content: {
          tag: 'div',
          data: { content: 'example-sentence' },
          content: [
            { tag: 'span', data: { content: 'example-sentence-a' }, content: 'あんな人' },
            { tag: 'span', data: { content: 'example-sentence-b' }, content: 'that kind of person' }
          ]
        }
      }
    ])
    const html = renderPopup({ results: [makeResult({ glossaryJson })] })
    expect(html).toContain('data-sc-content="example-sentence"')
    expect(html).toContain('data-sc-content="example-sentence-a"')
    expect(html).toContain('data-sc-content="example-sentence-b"')
    expect(html).toContain('あんな人')
    expect(html).toContain('that kind of person')
  })

  it('falls back to the legacy flattened glossary when glossaryJson is malformed', () => {
    const html = renderPopup({
      results: [makeResult({ glossary: 'to eat', glossaryJson: 'not json' })]
    })
    expect(html).toContain('to eat')
  })

  it('marks a high-priority row with data-priority for the CSS highlight', () => {
    const html = renderPopup({
      results: [makeResult({ termTags: 'P' }), makeResult({ expression: '物', termTags: '' })]
    })
    expect(html).toMatch(/data-priority="true"/)
    const priorityMatches = html.match(/data-priority="true"/g) ?? []
    expect(priorityMatches).toHaveLength(1)
  })
})

describe('WordPopup dictionary CSS injection', () => {
  it('renders a <style> tag with the scoped, sanitized CSS when a result has stylesCss', () => {
    const html = renderPopup({
      results: [
        makeResult({ dictId: 3, stylesCss: 'span[data-sc-content="pos"]{margin-right:4px}' })
      ]
    })
    expect(html).toContain('<style>@scope ([data-dict-id="3"])')
    expect(html).toContain('span[data-sc-content="pos"]{margin-right:4px}')
  })

  it('renders no <style> tag when a result stylesCss is entirely stripped by sanitization', () => {
    const html = renderPopup({
      results: [makeResult({ dictId: 9, stylesCss: '} html{filter:invert(1)} /*' })]
    })
    expect(html).not.toContain('<style>')
  })

  it('tags each row with data-dict-id matching its result', () => {
    const html = renderPopup({ results: [makeResult({ dictId: 42 })] })
    expect(html).toContain('data-dict-id="42"')
  })

  it('renders no <style> tag when no result has stylesCss', () => {
    const html = renderPopup()
    expect(html).not.toContain('<style>')
  })
})

const sampleToken: Token = makeToken({ surface: '食べる', reading: 'たべる', pos: '動詞' })
afterEach(cleanup)

describe('WordPopup Anki mining action', () => {
  it('renders one ＋ Anki button per row when onAddToAnki is supplied', () => {
    const tree = render(
      <WordPopup
        {...{
          results: sampleResults,
          position: { x: 0, y: 0 },
          onAddToAnki: vi.fn()
        }}
      />
    )
    const buttons = tree.container.querySelectorAll('.word-popup-anki-button')
    expect(buttons).toHaveLength(sampleResults.length)
  })

  it('is hidden (SSR markup has no anki button) when onAddToAnki is omitted', () => {
    const html = renderPopup()
    expect(html).not.toContain('word-popup-anki-button')
  })

  it("invoking a row's button onClick calls onAddToAnki with that row's own result", () => {
    const onAddToAnki = vi.fn()
    const tree = render(
      <WordPopup
        {...{
          results: sampleResults,
          position: { x: 0, y: 0 },
          onAddToAnki
        }}
      />
    )
    const buttons = tree.container.querySelectorAll('.word-popup-anki-button')

    fireEvent.click(buttons[1])

    expect(onAddToAnki).toHaveBeenCalledTimes(1)
    expect(onAddToAnki).toHaveBeenCalledWith(sampleResults[1])
  })

  it('renders "adding" status in place of the button while a mine request is in flight', () => {
    const html = renderPopup({ onAddToAnki: noop, ankiStatus: 'adding' })
    expect(html).not.toContain('word-popup-anki-button')
    expect(html).toContain('data-anki-status="adding"')
  })

  it('renders a "✓ Added" marker in place of the button when ankiStatus is added', () => {
    const html = renderPopup({ onAddToAnki: noop, ankiStatus: 'added' })
    expect(html).toContain('data-anki-status="added"')
    expect(html).toContain('Added')
  })

  it('renders an Updated marker after an overwrite', () => {
    const html = renderPopup({ onAddToAnki: noop, ankiStatus: 'updated' })
    expect(html).toContain('data-anki-status="updated"')
    expect(html).toContain('Updated')
  })

  it('renders a "✕ <error>" marker in place of the button when ankiStatus is error', () => {
    const html = renderPopup({
      onAddToAnki: noop,
      ankiStatus: 'error',
      ankiError: 'AnkiConnect not running'
    })
    expect(html).toContain('data-anki-status="error"')
    expect(html).toContain('AnkiConnect not running')
  })

  it('renders "Open in Anki" instead of the ＋ Anki button when ankiExisting is set', () => {
    const html = renderPopup({
      onAddToAnki: noop,
      ankiExisting: {
        [sampleResults[0].expression]: { cardId: 7 },
        [sampleResults[1].expression]: { cardId: 8 }
      }
    })
    expect(html).not.toContain('>＋ Anki<')
    expect(html).toContain('Open in Anki')
    expect(html).toContain('word-popup-anki-button--open')
  })

  it('clicking "Open in Anki" calls onOpenAnkiCard', () => {
    const onOpenAnkiCard = vi.fn()
    const tree = render(
      <WordPopup
        {...{
          results: sampleResults,
          position: { x: 0, y: 0 },
          onAddToAnki: noop,
          ankiExisting: {
            [sampleResults[0].expression]: { cardId: 7 },
            [sampleResults[1].expression]: { cardId: 8 }
          },
          onOpenAnkiCard
        }}
      />
    )
    const buttons = tree.container.querySelectorAll(
      '.word-popup-anki-button.word-popup-anki-button--open'
    )

    expect(buttons).toHaveLength(sampleResults.length)
    fireEvent.click(buttons[0])

    expect(onOpenAnkiCard).toHaveBeenCalledTimes(1)
    expect(onOpenAnkiCard).toHaveBeenCalledWith(7)
  })

  it('renders Update Anki instead of Open in Anki for overwrite matches', () => {
    const html = renderPopup({
      onAddToAnki: noop,
      duplicatePolicy: 'overwrite',
      ankiExisting: {
        [sampleResults[0].expression]: { cardId: 7 },
        [sampleResults[1].expression]: { cardId: 8 }
      }
    })
    expect(html).toContain('Update Anki')
    expect(html).not.toContain('Open in Anki')
  })

  it('clicking Update Anki mines the selected result instead of opening its card', () => {
    const onAddToAnki = vi.fn()
    const onOpenAnkiCard = vi.fn()
    const tree = render(
      <WordPopup
        {...{
          results: sampleResults,
          position: { x: 0, y: 0 },
          onAddToAnki,
          onOpenAnkiCard,
          duplicatePolicy: 'overwrite',
          ankiExisting: {
            [sampleResults[0].expression]: { cardId: 7 },
            [sampleResults[1].expression]: { cardId: 8 }
          }
        }}
      />
    )
    const buttons = tree.container.querySelectorAll(
      '.word-popup-anki-button.word-popup-anki-button--open'
    )

    fireEvent.click(buttons[0])

    expect(onAddToAnki).toHaveBeenCalledWith(sampleResults[0])
    expect(onOpenAnkiCard).not.toHaveBeenCalled()
  })

  it('a mutation status takes priority over refreshed ankiExisting state', () => {
    const html = renderPopup({
      onAddToAnki: noop,
      ankiStatus: 'added',
      ankiExisting: {
        [sampleResults[0].expression]: { cardId: 7 },
        [sampleResults[1].expression]: { cardId: 8 }
      }
    })
    expect(html).toContain('Added')
    expect(html).toContain('data-anki-status="added"')
  })

  it('accepts token/sentence props without affecting the rendered markup (forwarded only to onAddToAnki callers)', () => {
    const html = renderPopup({ token: sampleToken, sentence: '猫が食べる。' })
    expect(html).not.toContain('猫が食べる。')
  })
})

describe('WordPopup glossary link navigation', () => {
  function glossaryWithLink(href: string): string {
    return JSON.stringify([
      { type: 'structured-content', content: { tag: 'a', href, content: '閻魔' } }
    ])
  }

  it('renders a cross-reference link as a static (non-clickable) chip when onLinkClick is omitted', () => {
    const html = renderPopup({
      results: [makeResult({ glossaryJson: glossaryWithLink('?query=閻魔') })]
    })
    expect(html).toMatch(/class="word-popup-sc-link"[^>]*>閻魔</)
    expect(html).not.toContain('word-popup-sc-link--clickable')
  })

  it("renders the link as clickable and calls onLinkClick with the href's query term", () => {
    const onLinkClick = vi.fn()
    const tree = render(
      <WordPopup
        {...{
          results: [makeResult({ glossaryJson: glossaryWithLink('?query=閻魔') })],
          position: { x: 0, y: 0 },
          onLinkClick
        }}
      />
    )
    const links = tree.container.querySelectorAll('[role="button"]')
    expect(links).toHaveLength(1)

    fireEvent.click(links[0])

    expect(onLinkClick).toHaveBeenCalledTimes(1)
    expect(onLinkClick).toHaveBeenCalledWith('閻魔')
  })

  it('does not make a link clickable when its href has no internal query param', () => {
    const onLinkClick = vi.fn()
    const tree = render(
      <WordPopup
        {...{
          results: [makeResult({ glossaryJson: glossaryWithLink('https://example.com') })],
          position: { x: 0, y: 0 },
          onLinkClick
        }}
      />
    )
    expect(tree.container.querySelectorAll('[role="button"]')).toHaveLength(0)
  })

  it('hides the back button when onBack is supplied but canGoBack is false', () => {
    const html = renderPopup({ onBack: noop, canGoBack: false })
    expect(html).not.toContain('word-popup-back')
  })

  it('shows the back button and calls onBack when canGoBack is true', () => {
    const onBack = vi.fn()
    const tree = render(
      <WordPopup
        {...{
          results: sampleResults,
          position: { x: 0, y: 0 },
          onBack,
          canGoBack: true
        }}
      />
    )
    const backButtons = tree.container.querySelectorAll('.word-popup-back')
    expect(backButtons).toHaveLength(1)

    fireEvent.click(backButtons[0])

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('WordPopup scoped dictionary styles', () => {
  it('deduplicates dictionary styles in first-seen order and skips missing styles', () => {
    const a = 'span[data-sc-content="a"]{color:red}'
    const b = 'span[data-sc-content="b"]{color:blue}'
    const html = renderPopup({
      results: [
        makeResult({ dictId: 1, stylesCss: a }),
        makeResult({ dictId: 1, stylesCss: a }),
        makeResult({ dictId: 2, stylesCss: b }),
        makeResult({ dictId: 3, stylesCss: null })
      ]
    })
    expect(html.match(/<style>/g)).toHaveLength(2)
    expect(html.indexOf('@scope ([data-dict-id="1"])')).toBeLessThan(
      html.indexOf('@scope ([data-dict-id="2"])')
    )
  })
  it('prevents rule breakout and external image URLs in injected styles', () => {
    const html = renderPopup({
      results: [
        makeResult({
          dictId: 7,
          stylesCss:
            '} html{display:none} span[data-sc-content="x"]{color:red;background:url(http://evil/x)}'
        })
      ]
    })
    expect(html).not.toContain('url(')
    expect(html).not.toContain('html{')
    expect(html).toContain('@scope ([data-dict-id="7"])')
    expect(html).toContain('color:red')
  })
  it.each([
    ['P', '', true],
    ['news1 ichi1', '', true],
    ['', '★ priority form', true],
    ['', '', false],
    ['newsflash1', '', false]
  ])('marks priority only for recognized tags', (termTags, defTags, expected) => {
    expect(
      renderPopup({
        results: [makeResult({ termTags: termTags as string, defTags: defTags as string })]
      }).includes('data-priority="true"')
    ).toBe(expected)
  })
  it('omits unknown part-of-speech chips', () => {
    expect(renderPopup({ results: [makeResult({ rules: 'xyz', defTags: '' })] })).not.toContain(
      'word-popup-pos'
    )
  })
})
