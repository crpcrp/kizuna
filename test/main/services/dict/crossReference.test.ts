import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  parseStructuredGlossary,
  type GlossaryElement,
  type GlossaryNode
} from '../../../../src/shared/structuredGlossary'
import {
  extractSoleCrossReference,
  mergeCrossReferenceGlossary
} from '../../../../src/main/services/dict/crossReference'
import { lookup } from '../../../../src/main/services/dict/lookup'
import { initSchema } from '../../../../src/main/services/dict/schema'
import { buildNote } from '../../../../src/main/services/anki/noteBuilder'
import type { AnkiSettings } from '../../../../src/shared/anki'

const redirectGlossary = JSON.stringify([
  {
    type: 'structured-content',
    content: [
      { tag: 'span', content: '➶' },
      {
        tag: 'a',
        href: '?query=王様&wildcards=off',
        content: [
          { tag: 'ruby', content: ['王', { tag: 'rt', content: 'おう' }] },
          { tag: 'ruby', content: ['様', { tag: 'rt', content: 'さま' }] }
        ]
      }
    ]
  }
])

function elements(nodes: GlossaryNode[]): GlossaryElement[] {
  return nodes.flatMap((node) =>
    typeof node === 'string' ? [] : [node, ...elements(node.children)]
  )
}

describe('extractSoleCrossReference', () => {
  it('extracts a Jitendex-shaped redirect target and ruby reading', () => {
    expect(extractSoleCrossReference(redirectGlossary)).toEqual({
      query: '王様',
      reading: 'おうさま'
    })
  })

  it('rejects an internal link embedded in substantive prose', () => {
    const glossary = JSON.stringify([
      {
        type: 'structured-content',
        content: ['See ', { tag: 'a', href: '?query=王様', content: '王様' }]
      }
    ])
    expect(extractSoleCrossReference(glossary)).toBeNull()
  })

  it('rejects entries with more than one internal link', () => {
    const glossary = JSON.stringify([
      {
        type: 'structured-content',
        content: [
          { tag: 'a', href: '?query=王様', content: '王様' },
          { tag: 'a', href: '?query=女王', content: '女王' }
        ]
      }
    ])
    expect(extractSoleCrossReference(glossary)).toBeNull()
  })

  it('rejects absent, malformed, plain-text, and external-link glossaries', () => {
    const external = JSON.stringify([
      {
        type: 'structured-content',
        content: {
          tag: 'a',
          href: 'https://example.test/?query=王様',
          content: '王様'
        }
      }
    ])
    for (const glossary of [null, '{bad json', JSON.stringify(['plain text']), external]) {
      expect(extractSoleCrossReference(glossary)).toBeNull()
    }
  })
})

describe('mergeCrossReferenceGlossary', () => {
  it('wraps structured source and target content in one top-level item', () => {
    const merged = mergeCrossReferenceGlossary(
      { glossary: '➶王様', glossaryJson: redirectGlossary },
      {
        glossary: 'king; monarch',
        glossaryJson: JSON.stringify([{ type: 'text', text: 'king; monarch' }])
      }
    )
    const parsed = parseStructuredGlossary(merged.glossaryJson)
    expect(parsed).toHaveLength(1)
    expect(merged.glossary).toBe('➶王様\nking; monarch')

    const all = elements(parsed!)
    expect(
      all.some(
        (node) =>
          node.data.content === 'kizuna-xref-source' &&
          node.children.some((child) => typeof child !== 'string' && child.tag === 'a')
      )
    ).toBe(true)
    expect(
      all.some(
        (node) =>
          node.data.content === 'kizuna-xref-target' && node.children.includes('king; monarch')
      )
    ).toBe(true)
  })

  it('uses line breaks when a legacy target has no structured glossary', () => {
    const merged = mergeCrossReferenceGlossary(
      { glossary: '➶王様', glossaryJson: redirectGlossary },
      { glossary: 'king\nmonarch', glossaryJson: null }
    )
    const target = elements(parseStructuredGlossary(merged.glossaryJson)!).find(
      (node) => node.data.content === 'kizuna-xref-target'
    )!
    expect(target.children).toEqual(['king', expect.objectContaining({ tag: 'br' }), 'monarch'])
  })
})

function redirectTo(query: string, reading: string | null = null): string {
  const content: unknown[] = [{ tag: 'span', content: '➶' }]
  if (reading) {
    content.push({
      tag: 'a',
      href: `?query=${encodeURIComponent(query)}`,
      content: [query, { tag: 'rt', content: reading }]
    })
  } else {
    content.push({ tag: 'a', href: `?query=${encodeURIComponent(query)}`, content: query })
  }
  return JSON.stringify([{ type: 'structured-content', content }])
}

function xrefDb(
  rows: Array<{
    expression: string
    reading: string
    glossary: string
    glossaryJson: string | null
  }>
): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  const dictId = Number(
    db
      .prepare('INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)')
      .run('Cross-reference dictionary', '1', 1, 0).lastInsertRowid
  )
  const insert = db.prepare(
    `INSERT INTO terms (dict_id, expression, reading, glossary, glossary_json, score, sequence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const [index, row] of rows.entries()) {
    insert.run(dictId, row.expression, row.reading, row.glossary, row.glossaryJson, 0, index)
  }
  return db
}

describe('resolveCrossReferences through lookup', () => {
  it('resolves Jitendex’s real U+27F6 redirect marker and carries its audio target', () => {
    const db = xrefDb([
      {
        expression: '王さま',
        reading: '',
        glossary: '\u27F6王様',
        glossaryJson: JSON.stringify([
          {
            type: 'structured-content',
            content: {
              tag: 'div',
              content: [
                '\u27F6',
                {
                  tag: 'a',
                  href: '?query=%E7%8E%8B%E6%A7%98&wildcards=off&primary_reading=%E3%81%8A%E3%81%86%E3%81%95%E3%81%BE',
                  content: [
                    { tag: 'ruby', content: ['王', { tag: 'rt', content: 'おう' }] },
                    { tag: 'ruby', content: ['様', { tag: 'rt', content: 'さま' }] }
                  ]
                }
              ]
            }
          }
        ])
      },
      {
        expression: '王様',
        reading: 'おうさま',
        glossary: 'king; monarch',
        glossaryJson: JSON.stringify(['king; monarch'])
      }
    ])

    const [result] = lookup(db, { lemma: '王さま' })

    expect(result.glossary).toBe('\u27F6王様\nking; monarch')
    expect(result.audioExpression).toBe('王様')
    expect(result.audioReading).toBe('おうさま')
    db.close()
  })

  it('merges a resolved same-dictionary definition without changing result metadata', () => {
    const db = xrefDb([
      {
        expression: '王さま',
        reading: 'おうさま',
        glossary: '➶王様',
        glossaryJson: redirectTo('王様', 'おうさま')
      },
      {
        expression: '王様',
        reading: 'おうさま',
        glossary: 'king; monarch',
        glossaryJson: JSON.stringify(['king; monarch'])
      }
    ])

    const [result] = lookup(db, { lemma: '王さま' })
    expect(result).toMatchObject({ expression: '王さま', reading: 'おうさま', frequency: null })
    expect(result.glossary).toBe('➶王様\nking; monarch')
    expect(parseStructuredGlossary(result.glossaryJson!)?.[0]).toBeTruthy()
    expect(result.glossaryJson).toContain('king; monarch')
    db.close()
  })

  it('uses the linked ruby reading to disambiguate same-expression targets', () => {
    const db = xrefDb([
      {
        expression: '別表記',
        reading: 'べつひょうき',
        glossary: '➶本体',
        glossaryJson: redirectTo('本体', 'ほんたい')
      },
      {
        expression: '本体',
        reading: 'もとからだ',
        glossary: 'wrong reading',
        glossaryJson: JSON.stringify(['wrong reading'])
      },
      {
        expression: '本体',
        reading: 'ほんたい',
        glossary: 'matching reading',
        glossaryJson: JSON.stringify(['matching reading'])
      }
    ])

    expect(lookup(db, { lemma: '別表記' })[0].glossary).toContain('matching reading')
    db.close()
  })

  it('uses the resolved target for audio while mining the original cross-reference headword', () => {
    const db = xrefDb([
      {
        expression: '王さま',
        reading: 'おうさま',
        glossary: '→王様',
        glossaryJson: redirectTo('王様', 'おうさま')
      },
      {
        expression: '王様',
        reading: 'おうさま',
        glossary: 'king; monarch',
        glossaryJson: JSON.stringify(['king; monarch'])
      }
    ])
    const [result] = lookup(db, { lemma: '王さま' })
    const settings: AnkiSettings = {
      url: 'http://127.0.0.1:8765',
      apiKey: '',
      deckName: 'Japanese',
      modelName: 'Kizuna',
      fieldMap: {
        word: 'Word',
        reading: 'Reading',
        definition: 'Definition',
        sentence: 'Sentence',
        frequency: '',
        pitchAccent: '',
        wordAudio: 'WordAudio',
        picture: '',
        sentenceAudio: ''
      },
      tags: [],
      includeWordAudio: true,
      duplicatePolicy: 'prevent-deck'
    }

    const note = buildNote(
      {
        token: {
          surface: '王さま',
          reading: 'オウサマ',
          lemma: '王さま',
          pos: '名詞',
          startOffset: 0
        },
        result,
        sentence: '王さまだ。'
      },
      settings
    )

    expect(note.fields.Word).toBe('王さま')
    expect(note.audio?.[0].filename).toBe('kizuna_王様_おうさま.mp3')
    db.close()
  })

  it('follows a redirect chain of up to three hops', () => {
    const db = xrefDb([
      { expression: 'A', reading: 'a', glossary: '➶B', glossaryJson: redirectTo('B') },
      { expression: 'B', reading: 'b', glossary: '➶C', glossaryJson: redirectTo('C') },
      {
        expression: 'C',
        reading: 'c',
        glossary: 'resolved C',
        glossaryJson: JSON.stringify(['resolved C'])
      }
    ])

    expect(lookup(db, { lemma: 'A' })[0].glossary).toBe('➶B\nresolved C')
    db.close()
  })

  it('resolves exactly three redirect hops', () => {
    const db = xrefDb([
      { expression: 'A3', reading: 'a3', glossary: 'source A3', glossaryJson: redirectTo('B3') },
      { expression: 'B3', reading: 'b3', glossary: 'source B3', glossaryJson: redirectTo('C3') },
      { expression: 'C3', reading: 'c3', glossary: 'source C3', glossaryJson: redirectTo('D3') },
      {
        expression: 'D3',
        reading: 'd3',
        glossary: 'resolved D3',
        glossaryJson: JSON.stringify(['resolved D3'])
      }
    ])

    expect(lookup(db, { lemma: 'A3' })[0].glossary).toBe('source A3\nresolved D3')
    db.close()
  })

  it('leaves a fourth redirect hop unchanged', () => {
    const db = xrefDb([
      { expression: 'A4', reading: 'a4', glossary: 'source A4', glossaryJson: redirectTo('B4') },
      { expression: 'B4', reading: 'b4', glossary: 'source B4', glossaryJson: redirectTo('C4') },
      { expression: 'C4', reading: 'c4', glossary: 'source C4', glossaryJson: redirectTo('D4') },
      { expression: 'D4', reading: 'd4', glossary: 'source D4', glossaryJson: redirectTo('E4') },
      {
        expression: 'E4',
        reading: 'e4',
        glossary: 'resolved E4',
        glossaryJson: JSON.stringify(['resolved E4'])
      }
    ])

    expect(lookup(db, { lemma: 'A4' })[0].glossary).toBe('source A4')
    db.close()
  })

  it('leaves cycles and missing targets unchanged while preserving normal rows', () => {
    const cycleDb = xrefDb([
      { expression: 'A', reading: 'a', glossary: '➶B', glossaryJson: redirectTo('B') },
      { expression: 'B', reading: 'b', glossary: '➶A', glossaryJson: redirectTo('A') }
    ])
    expect(lookup(cycleDb, { lemma: 'A' })[0].glossary).toBe('➶B')
    cycleDb.close()

    const missingDb = xrefDb([
      {
        expression: 'Missing',
        reading: 'missing',
        glossary: '➶Absent',
        glossaryJson: redirectTo('Absent')
      },
      {
        expression: 'Plain',
        reading: 'plain',
        glossary: 'ordinary definition',
        glossaryJson: JSON.stringify(['ordinary definition'])
      }
    ])
    const [missing] = lookup(missingDb, { lemma: 'Missing' })
    const [plain] = lookup(missingDb, { lemma: 'Plain' })
    expect(missing.glossary).toBe('➶Absent')
    expect(plain).toMatchObject({
      glossary: 'ordinary definition',
      glossaryJson: JSON.stringify(['ordinary definition'])
    })
    missingDb.close()
  })
})
