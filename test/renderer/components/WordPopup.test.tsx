import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WordPopup, {
  splitSenses,
  isHighPriority,
  posAttributes,
  dictStylesheets,
  scopeDictCss
} from '@src/renderer/src/components/WordPopup'
import type { LookupResult } from '@src/shared/dictionary'
import type { KnowledgeDetails } from '@src/shared/knowledge'
import type { Token } from '@src/shared/token'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy,
// mirroring test/optionsMenu.test.tsx exactly.

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
  return {
    expression: '食べる',
    reading: 'たべる',
    glossary: 'to eat',
    dictTitle: 'Jitendex',
    dictId: 1,
    stylesCss: null,
    frequency: null,
    frequencyDisplay: null,
    pitchAccent: null,
    defTags: '',
    termTags: '',
    score: 0,
    rules: '',
    ...overrides
  }
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

describe('WordPopup markup', () => {
  it('renders all WaniKani and Anki provenance badges directly below the headword', () => {
    const provenance: KnowledgeDetails = {
      level: 'known',
      sources: [
        { source: 'wanikani', curriculumLevel: 12, proficiency: 'Apprentice' },
        { source: 'anki', deck: 'Japanese', intervalDays: 21, cardId: 1, noteId: 2 },
        { source: 'anki', deck: 'Anime', intervalDays: 90, cardId: 3, noteId: 4 }
      ]
    }
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult()]}
        position={{ x: 0, y: 0 }}
        provenanceByExpression={{ [makeResult().expression]: provenance }}
      />
    )

    expect(html).toContain('WaniKani - Level 12 - Apprentice')
    expect(html).toContain('Anki - Japanese - 21d')
    expect(html).toContain('Anki - Anime - 90d')
    expect(html.indexOf('word-popup-headword')).toBeLessThan(html.indexOf('word-popup-provenance'))
  })

  it('omits the provenance block when no source details exist', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult()]}
        position={{ x: 0, y: 0 }}
        provenanceByExpression={{ [makeResult().expression]: { level: 'unknown', sources: [] } }}
      />
    )

    expect(html).not.toContain('word-popup-provenance')
  })

  it('is present but hidden (no "open" class) when position is null', () => {
    const html = renderToStaticMarkup(
      <WordPopup results={sampleResults} position={null} onClose={noop} />
    )
    expect(html).toContain('id="word-popup"')
    expect(html).not.toMatch(/id="word-popup"[^>]*\bopen\b/)
    expect(html).toContain('aria-hidden="true"')
  })

  it('adds the "open" class and drops aria-hidden when position is set', () => {
    const html = renderToStaticMarkup(
      <WordPopup results={sampleResults} position={{ x: 10, y: 20 }} onClose={noop} />
    )
    expect(html).toMatch(/id="word-popup"[^>]*class="word-popup open"/)
    expect(html).toContain('aria-hidden="false"')
  })

  it('renders an explicit empty-state message when position is set but results is empty', () => {
    const html = renderToStaticMarkup(
      <WordPopup results={[]} position={{ x: 10, y: 20 }} onClose={noop} />
    )
    expect(html).toContain('No definition found')
    expect(html).not.toContain('word-popup-row')
  })

  it('renders one row per result with expression, reading, glossary, and dictTitle', () => {
    const html = renderToStaticMarkup(
      <WordPopup results={sampleResults} position={{ x: 10, y: 20 }} onClose={noop} />
    )
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
    const html = renderToStaticMarkup(
      <WordPopup results={sampleResults} position={{ x: 123, y: 456 }} onClose={noop} />
    )
    expect(html).toMatch(/id="word-popup"[^>]*style="left:123px;top:456px"/)
  })

  it('renders the close button as a sibling of the scrollable panel, not nested inside it', () => {
    // The panel scrolls (overflow-y: auto in WordPopup.css); a close button
    // nested inside it would scroll out of view with the entry list. It must
    // stay outside .word-popup-panel so it's always clickable.
    const html = renderToStaticMarkup(
      <WordPopup results={sampleResults} position={{ x: 10, y: 20 }} onClose={noop} />
    )
    const panelClassIndex = html.indexOf('class="word-popup-panel"')
    const panelOpenStart = html.lastIndexOf('<div', panelClassIndex)
    const panelCloseEnd = findMatchingDivClose(html, panelOpenStart)
    const closeButtonIndex = html.indexOf('word-popup-close')
    expect(panelClassIndex).toBeGreaterThan(-1)
    expect(closeButtonIndex).toBeGreaterThan(panelCloseEnd)
  })

  it('does not fire onClose merely by rendering', () => {
    const onClose = vi.fn()
    renderToStaticMarkup(
      <WordPopup results={sampleResults} position={{ x: 10, y: 20 }} onClose={onClose} />
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders furigana as ruby/rt when reading differs from expression', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ expression: '食べる', reading: 'たべる' })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).toContain('<ruby>')
    expect(html).toMatch(/<rt[^>]*class="word-popup-furigana"[^>]*>たべる<\/rt>/)
  })

  it('omits furigana when reading equals expression or is empty', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ expression: 'ここ', reading: 'ここ' })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).not.toContain('<ruby>')
  })

  it('shows a priority marker for a Jitendex definition-tag priority entry only', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[
          makeResult({ termTags: '', defTags: '★ priority form' }),
          makeResult({ expression: '物', termTags: '', defTags: '' })
        ]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    const priorityMatches = html.match(/word-popup-priority/g) ?? []
    expect(priorityMatches).toHaveLength(1)
  })

  it('shows frequency display text when frequency is present', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ frequency: 12, frequencyDisplay: '12㋕' })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).toContain('word-popup-frequency')
    expect(html).toContain('12㋕')
  })

  it('falls back to the raw frequency number when frequencyDisplay is null', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ frequency: 42, frequencyDisplay: null })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).toContain('>42<')
  })

  it("renders each result's pitch accent and omits empty metadata", () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[
          makeResult({ expression: '一つ', pitchAccent: [1] }),
          makeResult({ expression: '食べ物', pitchAccent: [1, 3] })
        ]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )

    expect(html.match(/class="word-popup-pitch-accent"/g) ?? []).toHaveLength(2)
    const singlePitch = html.indexOf('aria-label="Pitch accent: 1"')
    const secondRow = html.indexOf('食べ物')
    const multiplePitch = html.indexOf('aria-label="Pitch accent: 1, 3"')
    expect(singlePitch).toBeGreaterThan(-1)
    expect(singlePitch).toBeLessThan(secondRow)
    expect(multiplePitch).toBeGreaterThan(secondRow)
    expect(html).toContain('Pitch 1, 3')

    const absent = renderToStaticMarkup(
      <WordPopup
        results={[
          makeResult({ expression: '空', pitchAccent: null }),
          makeResult({ expression: '空っぽ', pitchAccent: [] })
        ]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(absent).not.toContain('word-popup-pitch-accent')
    expect(absent).not.toContain('Pitch accent:')
  })

  it('renders human-readable part-of-speech chips from rules/defTags', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ rules: 'v5r vt', defTags: 'n' })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).toContain('godan verb')
    expect(html).toContain('transitive')
    expect(html).toContain('noun')
  })

  it('splits multi-sense glossaries into one numbered badge per sense', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ glossary: 'here\nthis place' })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).toMatch(/word-popup-sense-number">1</)
    expect(html).toMatch(/word-popup-sense-number">2</)
    expect(html).toContain('here')
    expect(html).toContain('this place')
  })

  it('renders a single-sense glossary without a numbered badge', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ glossary: 'to eat' })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).not.toContain('word-popup-sense-number')
    expect(html).toContain('to eat')
  })

  it('caps the number of rendered entries at maxEntries', () => {
    const html = renderToStaticMarkup(
      <WordPopup results={sampleResults} position={{ x: 0, y: 0 }} onClose={noop} maxEntries={1} />
    )
    const rowMatches = html.match(/data-testid="word-popup-row"/g) ?? []
    expect(rowMatches).toHaveLength(1)
  })

  it('caps the number of rendered senses per entry at maxMeanings', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ glossary: 'one\ntwo\nthree' })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
        maxMeanings={2}
      />
    )
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
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ glossaryJson })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
        maxMeanings={2}
      />
    )

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
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ glossary: '→王様\nresolved definition', glossaryJson })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
        maxMeanings={1}
      />
    )

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
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ glossaryJson })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
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
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ glossaryJson })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
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
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ glossaryJson })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).toContain('data-sc-content="example-sentence"')
    expect(html).toContain('data-sc-content="example-sentence-a"')
    expect(html).toContain('data-sc-content="example-sentence-b"')
    expect(html).toContain('あんな人')
    expect(html).toContain('that kind of person')
  })

  it('falls back to the legacy flattened glossary when glossaryJson is malformed', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ glossary: 'to eat', glossaryJson: 'not json' })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).toContain('to eat')
  })

  it('marks a high-priority row with data-priority for the CSS highlight', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ termTags: 'P' }), makeResult({ expression: '物', termTags: '' })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).toMatch(/data-priority="true"/)
    const priorityMatches = html.match(/data-priority="true"/g) ?? []
    expect(priorityMatches).toHaveLength(1)
  })
})

describe('dictStylesheets', () => {
  it('returns one entry per distinct dictId that has a non-null stylesCss', () => {
    const results = [
      makeResult({ dictId: 1, stylesCss: '.a {}' }),
      makeResult({ dictId: 2, stylesCss: '.b {}' })
    ]
    expect(dictStylesheets(results)).toEqual([
      { dictId: 1, css: '.a {}' },
      { dictId: 2, css: '.b {}' }
    ])
  })

  it('dedupes repeated dictIds, keeping first-seen order', () => {
    const results = [
      makeResult({ dictId: 1, stylesCss: '.a {}' }),
      makeResult({ expression: '別', dictId: 1, stylesCss: '.a {}' }),
      makeResult({ dictId: 2, stylesCss: '.b {}' })
    ]
    expect(dictStylesheets(results)).toEqual([
      { dictId: 1, css: '.a {}' },
      { dictId: 2, css: '.b {}' }
    ])
  })

  it('skips dictionaries with no stylesCss', () => {
    const results = [makeResult({ dictId: 1, stylesCss: null })]
    expect(dictStylesheets(results)).toEqual([])
  })
})

describe('scopeDictCss', () => {
  it('wraps the sanitized CSS in an @scope block keyed to the dict id', () => {
    const scoped = scopeDictCss(7, 'span[data-sc-content="tag"]{margin-right:4px}')
    expect(scoped).toContain('@scope ([data-dict-id="7"]) {')
    expect(scoped).toContain('span[data-sc-content="tag"]{margin-right:4px}')
  })

  it('does not let a `}` in the dictionary CSS escape the @scope block', () => {
    // A `}` would, if injected verbatim, close the @scope block early and let
    // `html{display:none}` apply app-wide. Sanitization drops the
    // brace and the non-`[data-sc-*]` `html` rule entirely.
    const scoped = scopeDictCss(1, '} html{display:none}')
    expect(scoped).not.toMatch(/(^|})\s*html\s*\{/)
  })

  it('keeps a benign scoped rule after sanitization', () => {
    const scoped = scopeDictCss(1, 'span[data-sc-content="note"]{color:red}')
    expect(scoped).toContain('[data-dict-id="1"]')
    expect(scoped).toContain('color:red')
  })

  it('strips external url() values', () => {
    const scoped = scopeDictCss(1, 'span[data-sc-content="x"]{background:url(http://evil/x)}')
    expect(scoped).not.toContain('url(')
  })

  it('returns an empty string when nothing survives sanitization', () => {
    expect(scopeDictCss(1, '} html{display:none} /*')).toBe('')
  })
})

describe('WordPopup dictionary CSS injection', () => {
  it('renders a <style> tag with the scoped, sanitized CSS when a result has stylesCss', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[
          makeResult({ dictId: 3, stylesCss: 'span[data-sc-content="pos"]{margin-right:4px}' })
        ]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).toContain('<style>@scope ([data-dict-id="3"])')
    expect(html).toContain('span[data-sc-content="pos"]{margin-right:4px}')
  })

  it('renders no <style> tag when a result stylesCss is entirely stripped by sanitization', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ dictId: 9, stylesCss: '} html{filter:invert(1)} /*' })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).not.toContain('<style>')
  })

  it('tags each row with data-dict-id matching its result', () => {
    const html = renderToStaticMarkup(
      <WordPopup results={[makeResult({ dictId: 42 })]} position={{ x: 0, y: 0 }} onClose={noop} />
    )
    expect(html).toContain('data-dict-id="42"')
  })

  it('renders no <style> tag when no result has stylesCss', () => {
    const html = renderToStaticMarkup(
      <WordPopup results={sampleResults} position={{ x: 0, y: 0 }} onClose={noop} />
    )
    expect(html).not.toContain('<style>')
  })
})

describe('splitSenses', () => {
  it('splits on newline, trimming whitespace and dropping empty lines', () => {
    expect(splitSenses(' here \n\n this place \n')).toEqual(['here', 'this place'])
  })

  it('returns a single-element array for a glossary with no separators', () => {
    expect(splitSenses('to eat')).toEqual(['to eat'])
  })
})

describe('isHighPriority', () => {
  it('returns true when termTags contains a known priority tag', () => {
    expect(isHighPriority('P')).toBe(true)
    expect(isHighPriority('news1 ichi1')).toBe(true)
    expect(isHighPriority('', '★ priority form')).toBe(true)
  })

  it('returns false for unknown tags or an empty string', () => {
    expect(isHighPriority('')).toBe(false)
    expect(isHighPriority('newsflash1')).toBe(false)
  })
})

/**
 * Recursively collects every React element in `node`'s tree (via
 * `.props.children`) matching `predicate`, in document order. Used to reach
 * into the "＋ Anki" button's `onClick` prop directly, since SSR strings
 * can't simulate a click and this codebase's testing policy forbids jsdom —
 * see the file header. `WordPopup` is a plain function component with no
 * hooks, so calling it directly (instead of rendering it) is safe and
 * returns the real, uninvoked React element tree.
 */
type ElementNode = { props: Record<string, unknown> }

function findAll(
  node: unknown,
  predicate: (el: ElementNode) => boolean,
  acc: ElementNode[] = []
): ElementNode[] {
  if (node === null || node === undefined || typeof node !== 'object') return acc
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, acc)
    return acc
  }
  const el = node as { props?: Record<string, unknown> }
  if (el.props === undefined) return acc
  if (predicate(el as ElementNode)) acc.push(el as ElementNode)
  findAll(el.props.children, predicate, acc)
  return acc
}

/** Narrows an element's `onClick` prop out of the untyped tree above. */
function onClickOf(el: ElementNode): () => void {
  return el.props.onClick as () => void
}

const sampleToken: Token = {
  surface: '食べる',
  reading: 'たべる',
  lemma: '食べる',
  pos: '動詞',
  startOffset: 0
}

describe('WordPopup Anki mining action', () => {
  it('renders one ＋ Anki button per row when onAddToAnki is supplied', () => {
    const tree = WordPopup({
      results: sampleResults,
      position: { x: 0, y: 0 },
      onAddToAnki: vi.fn()
    })
    const buttons = findAll(tree, (el) => el.props?.className === 'word-popup-anki-button')
    expect(buttons).toHaveLength(sampleResults.length)
  })

  it('is hidden (SSR markup has no anki button) when onAddToAnki is omitted', () => {
    const html = renderToStaticMarkup(
      <WordPopup results={sampleResults} position={{ x: 0, y: 0 }} onClose={noop} />
    )
    expect(html).not.toContain('word-popup-anki-button')
  })

  it("invoking a row's button onClick calls onAddToAnki with that row's own result", () => {
    const onAddToAnki = vi.fn()
    const tree = WordPopup({
      results: sampleResults,
      position: { x: 0, y: 0 },
      onAddToAnki
    })
    const buttons = findAll(tree, (el) => el.props?.className === 'word-popup-anki-button')

    onClickOf(buttons[1])()

    expect(onAddToAnki).toHaveBeenCalledTimes(1)
    expect(onAddToAnki).toHaveBeenCalledWith(sampleResults[1])
  })

  it('renders "adding" status in place of the button while a mine request is in flight', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={sampleResults}
        position={{ x: 0, y: 0 }}
        onAddToAnki={noop}
        ankiStatus="adding"
      />
    )
    expect(html).not.toContain('word-popup-anki-button')
    expect(html).toContain('data-anki-status="adding"')
  })

  it('renders a "✓ Added" marker in place of the button when ankiStatus is added', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={sampleResults}
        position={{ x: 0, y: 0 }}
        onAddToAnki={noop}
        ankiStatus="added"
      />
    )
    expect(html).toContain('data-anki-status="added"')
    expect(html).toContain('Added')
  })

  it('renders an Updated marker after an overwrite', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={sampleResults}
        position={{ x: 0, y: 0 }}
        onAddToAnki={noop}
        ankiStatus="updated"
      />
    )
    expect(html).toContain('data-anki-status="updated"')
    expect(html).toContain('Updated')
  })

  it('renders a "✕ <error>" marker in place of the button when ankiStatus is error', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={sampleResults}
        position={{ x: 0, y: 0 }}
        onAddToAnki={noop}
        ankiStatus="error"
        ankiError="AnkiConnect not running"
      />
    )
    expect(html).toContain('data-anki-status="error"')
    expect(html).toContain('AnkiConnect not running')
  })

  it('renders "Open in Anki" instead of the ＋ Anki button when ankiExisting is set', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={sampleResults}
        position={{ x: 0, y: 0 }}
        onAddToAnki={noop}
        ankiExisting={{
          [sampleResults[0].expression]: { cardId: 7 },
          [sampleResults[1].expression]: { cardId: 8 }
        }}
      />
    )
    expect(html).not.toContain('>＋ Anki<')
    expect(html).toContain('Open in Anki')
    expect(html).toContain('word-popup-anki-button--open')
  })

  it('clicking "Open in Anki" calls onOpenAnkiCard', () => {
    const onOpenAnkiCard = vi.fn()
    const tree = WordPopup({
      results: sampleResults,
      position: { x: 0, y: 0 },
      onAddToAnki: noop,
      ankiExisting: {
        [sampleResults[0].expression]: { cardId: 7 },
        [sampleResults[1].expression]: { cardId: 8 }
      },
      onOpenAnkiCard
    })
    const buttons = findAll(
      tree,
      (el) => el.props?.className === 'word-popup-anki-button word-popup-anki-button--open'
    )

    expect(buttons).toHaveLength(sampleResults.length)
    onClickOf(buttons[0])()

    expect(onOpenAnkiCard).toHaveBeenCalledTimes(1)
    expect(onOpenAnkiCard).toHaveBeenCalledWith(7)
  })

  it('renders Update Anki instead of Open in Anki for overwrite matches', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={sampleResults}
        position={{ x: 0, y: 0 }}
        onAddToAnki={noop}
        duplicatePolicy="overwrite"
        ankiExisting={{
          [sampleResults[0].expression]: { cardId: 7 },
          [sampleResults[1].expression]: { cardId: 8 }
        }}
      />
    )
    expect(html).toContain('Update Anki')
    expect(html).not.toContain('Open in Anki')
  })

  it('clicking Update Anki mines the selected result instead of opening its card', () => {
    const onAddToAnki = vi.fn()
    const onOpenAnkiCard = vi.fn()
    const tree = WordPopup({
      results: sampleResults,
      position: { x: 0, y: 0 },
      onAddToAnki,
      onOpenAnkiCard,
      duplicatePolicy: 'overwrite',
      ankiExisting: {
        [sampleResults[0].expression]: { cardId: 7 },
        [sampleResults[1].expression]: { cardId: 8 }
      }
    })
    const buttons = findAll(
      tree,
      (el) => el.props?.className === 'word-popup-anki-button word-popup-anki-button--open'
    )

    onClickOf(buttons[0])()

    expect(onAddToAnki).toHaveBeenCalledWith(sampleResults[0])
    expect(onOpenAnkiCard).not.toHaveBeenCalled()
  })

  it('a mutation status takes priority over refreshed ankiExisting state', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={sampleResults}
        position={{ x: 0, y: 0 }}
        onAddToAnki={noop}
        ankiStatus="added"
        ankiExisting={{
          [sampleResults[0].expression]: { cardId: 7 },
          [sampleResults[1].expression]: { cardId: 8 }
        }}
      />
    )
    expect(html).toContain('Added')
    expect(html).toContain('data-anki-status="added"')
  })

  it('accepts token/sentence props without affecting the rendered markup (forwarded only to onAddToAnki callers)', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={sampleResults}
        position={{ x: 0, y: 0 }}
        token={sampleToken}
        sentence="猫が食べる。"
        onClose={noop}
      />
    )
    expect(html).not.toContain('猫が食べる。')
  })
})

describe('posAttributes', () => {
  it('unions rules and defTags tokens into human labels, deduped in first-seen order', () => {
    expect(posAttributes('v5r vt', 'v5r vt n')).toEqual(['godan verb', 'transitive', 'noun'])
  })

  it('drops unknown tokens and returns an empty array when nothing matches', () => {
    expect(posAttributes('xyz', '')).toEqual([])
  })
})

describe('WordPopup glossary link navigation', () => {
  function glossaryWithLink(href: string): string {
    return JSON.stringify([
      { type: 'structured-content', content: { tag: 'a', href, content: '閻魔' } }
    ])
  }

  it('renders a cross-reference link as a static (non-clickable) chip when onLinkClick is omitted', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={[makeResult({ glossaryJson: glossaryWithLink('?query=閻魔') })]}
        position={{ x: 0, y: 0 }}
        onClose={noop}
      />
    )
    expect(html).toMatch(/class="word-popup-sc-link"[^>]*>閻魔</)
    expect(html).not.toContain('word-popup-sc-link--clickable')
  })

  it("renders the link as clickable and calls onLinkClick with the href's query term", () => {
    const onLinkClick = vi.fn()
    const tree = WordPopup({
      results: [makeResult({ glossaryJson: glossaryWithLink('?query=閻魔') })],
      position: { x: 0, y: 0 },
      onLinkClick
    })
    const links = findAll(tree, (el) => el.props?.role === 'button')
    expect(links).toHaveLength(1)

    onClickOf(links[0])()

    expect(onLinkClick).toHaveBeenCalledTimes(1)
    expect(onLinkClick).toHaveBeenCalledWith('閻魔')
  })

  it('does not make a link clickable when its href has no internal query param', () => {
    const onLinkClick = vi.fn()
    const tree = WordPopup({
      results: [makeResult({ glossaryJson: glossaryWithLink('https://example.com') })],
      position: { x: 0, y: 0 },
      onLinkClick
    })
    expect(findAll(tree, (el) => el.props?.role === 'button')).toHaveLength(0)
  })

  it('hides the back button when onBack is supplied but canGoBack is false', () => {
    const html = renderToStaticMarkup(
      <WordPopup
        results={sampleResults}
        position={{ x: 0, y: 0 }}
        onClose={noop}
        onBack={noop}
        canGoBack={false}
      />
    )
    expect(html).not.toContain('word-popup-back')
  })

  it('shows the back button and calls onBack when canGoBack is true', () => {
    const onBack = vi.fn()
    const tree = WordPopup({
      results: sampleResults,
      position: { x: 0, y: 0 },
      onBack,
      canGoBack: true
    })
    const backButtons = findAll(tree, (el) => el.props?.className === 'word-popup-back')
    expect(backButtons).toHaveLength(1)

    onClickOf(backButtons[0])()

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
