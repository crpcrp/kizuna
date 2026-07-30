import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@src/main/services/dict/schema'
import {
  deinflect,
  lookup,
  attachFrequencies,
  sortByFrequency,
  frequencyModeForDict,
  type LookupDb
} from '@src/main/services/dict/lookup'
import type { LookupResult } from '@src/shared/dictionary'

describe('deinflect', () => {
  it('always includes the unmodified surface as a candidate', () => {
    expect(deinflect('食べる')).toContain('食べる')
    expect(deinflect('猫')).toContain('猫')
  })

  it('undoes past tense (-た)', () => {
    expect(deinflect('食べた')).toContain('食べる')
  })

  it('undoes te-form (-て)', () => {
    expect(deinflect('食べて')).toContain('食べる')
  })

  it('undoes negative (-ない)', () => {
    expect(deinflect('食べない')).toContain('食べる')
  })

  it('undoes polite forms (-ます/-ました/-ません)', () => {
    expect(deinflect('飲みます')).toContain('飲む')
    expect(deinflect('飲みました')).toContain('飲む')
    expect(deinflect('飲みません')).toContain('飲む')
  })

  it('undoes potential/passive (-れる/-られる)', () => {
    expect(deinflect('食べられる')).toContain('食べる')
    // 飲まれる's mizenkei stem is 飲ま (a-row); the correct godan reconstruction is
    // 飲む. The flat ichidan guess 飲まる is a harmless false candidate that the
    // fallback-net design tolerates (it simply misses in the DB), so we don't
    // assert its absence -- but the correct candidate must be present.
    expect(deinflect('飲まれる')).toContain('飲む')
  })

  it('undoes negative (-ない) for godan verbs via the mizenkei stem', () => {
    expect(deinflect('飲まない')).toContain('飲む')
  })

  it('undoes want-to (-たい)', () => {
    expect(deinflect('食べたい')).toContain('食べる')
  })
})

describe('lookup', () => {
  function fakeLookupDb(expressions: string[], frequencies: Record<string, number> = {}): LookupDb {
    return fakeLookupDbRows(
      expressions.map((expression, index) => ({
        expression,
        reading: expression,
        dictId: index + 1
      })),
      Object.entries(frequencies).map(([expression, value]) => ({
        expression,
        reading: null,
        value
      }))
    )
  }

  function fakeLookupDbRows(
    entries: Array<{
      expression: string
      reading: string
      score?: number
      defTags?: string
      dictId?: number
      fallbackOnly?: boolean
    }>,
    frequencies: Array<{ expression: string; reading: string | null; value: number }>
  ): LookupDb {
    const rows = entries.map((entry, index) => ({
      expression: entry.expression,
      reading: entry.reading,
      glossary: entry.expression,
      glossary_json: null,
      title: 'Fake Dict',
      dict_id: entry.dictId ?? index + 1,
      fallback_only: entry.fallbackOnly ? 1 : 0,
      styles_css: null,
      def_tags: entry.defTags ?? null,
      term_tags: null,
      rules: null,
      score: entry.score ?? 0
    }))
    return {
      exec() {
        return undefined
      },
      prepare(sql: string) {
        return {
          all(...params: unknown[]) {
            if (sql.includes('FROM term_meta')) {
              return frequencies.map(({ expression, reading, value }) => ({
                expression,
                reading,
                value,
                display: String(value)
              }))
            }
            if (sql.includes('frequency_mode')) return [{ frequency_mode: 'rank-based' }]
            const queries = new Set(
              params.filter((value): value is string => typeof value === 'string')
            )
            return rows.filter((row) => queries.has(row.expression) || queries.has(row.reading))
          }
        }
      }
    }
  }

  it('uses frequency before exact written form only when both entries have frequency data', () => {
    const kotoni = fakeLookupDbRows(
      [
        { expression: 'ことに', reading: 'ことに', score: 0 },
        { expression: '殊に', reading: 'ことに', score: 200 }
      ],
      [
        { expression: 'ことに', reading: null, value: 72191 },
        { expression: '殊に', reading: null, value: 21441 }
      ]
    )
    expect(lookup(kotoni, { lemma: 'ことに' }, { freqDictId: 1 }).map((r) => r.expression)).toEqual(
      ['殊に', 'ことに']
    )

    const ora = fakeLookupDbRows(
      [
        { expression: 'オラ', reading: 'オラ' },
        { expression: '己', reading: 'おら' }
      ],
      [
        { expression: 'オラ', reading: null, value: 95293 },
        { expression: '己', reading: 'おら', value: 9435 }
      ]
    )
    expect(
      lookup(ora, { lemma: 'オラ', reading: 'オラ' }, { freqDictId: 1 }).map((r) => r.expression)
    ).toEqual(['己', 'オラ'])

    const exactWithoutFrequency = fakeLookupDbRows(
      [
        { expression: 'ことに', reading: 'ことに' },
        { expression: '殊に', reading: 'ことに' }
      ],
      [{ expression: '殊に', reading: null, value: 21441 }]
    )
    expect(
      lookup(exactWithoutFrequency, { lemma: 'ことに' }, { freqDictId: 1 })[0].expression
    ).toBe('ことに')

    const readingWithoutFrequency = fakeLookupDbRows(
      [
        { expression: 'ことに', reading: 'ことに' },
        { expression: '殊に', reading: 'ことに' }
      ],
      [{ expression: 'ことに', reading: null, value: 72191 }]
    )
    expect(
      lookup(readingWithoutFrequency, { lemma: 'ことに' }, { freqDictId: 1 })[0].expression
    ).toBe('ことに')

    const occurrence = fakeLookupDbRows(
      [
        { expression: 'ことに', reading: 'ことに' },
        { expression: '殊に', reading: 'ことに' }
      ],
      [
        { expression: 'ことに', reading: null, value: 1 },
        { expression: '殊に', reading: null, value: 900 }
      ]
    )
    expect(
      lookup(occurrence, { lemma: 'ことに' }, { freqDictId: 1, sortMode: 'occurrence-based' }).map(
        (r) => r.expression
      )
    ).toEqual(['殊に', 'ことに'])

    const compounds = fakeLookupDbRows(
      [
        { expression: '閻魔大王', reading: 'えんまだいおう' },
        { expression: '閻魔', reading: 'えんま' }
      ],
      [
        { expression: '閻魔大王', reading: null, value: 8000 },
        { expression: '閻魔', reading: null, value: 200 }
      ]
    )
    expect(
      lookup(
        compounds,
        { lemma: '閻魔', longestMatchCandidates: ['閻魔大王', '閻魔'] },
        { freqDictId: 1 }
      ).map((r) => r.expression)
    ).toEqual(['閻魔大王', '閻魔'])
  })

  it('ranks a Jitendex definition-tag priority match above an otherwise equal reading match', () => {
    const db = fakeLookupDbRows(
      [
        { expression: '己', reading: 'おら', defTags: '★ priority form' },
        { expression: '俺', reading: 'おら', defTags: '' }
      ],
      []
    )

    expect(
      lookup(db, { lemma: 'オラ', reading: 'おら' }).map((result) => result.expression)
    ).toEqual(['己', '俺'])
  })

  it('demotes fallback-only dictionary rows below normal rows while retaining them', () => {
    const db = fakeLookupDbRows(
      [
        { expression: 'ăŠă‚‰', reading: 'ăŠă‚‰', fallbackOnly: true },
        { expression: 'ĺ·±', reading: 'ăŠă‚‰' }
      ],
      []
    )

    expect(lookup(db, { lemma: 'ăŠă‚‰' }).map((result) => result.expression)).toEqual([
      'ĺ·±',
      'ăŠă‚‰'
    ])
    expect(
      lookup(
        fakeLookupDbRows([{ expression: 'ăŠă‚‰', reading: 'ăŠă‚‰', fallbackOnly: true }], []),
        { lemma: 'ăŠă‚‰' }
      ).map((result) => result.expression)
    ).toEqual(['ăŠă‚‰'])
  })

  it('reports exact auxiliary-bearing candidate provenance without consuming a trailing particle', () => {
    const db = fakeLookupDb(['何とかなる', '何とか'])

    const results = lookup(db, {
      lemma: '何とか',
      longestMatchCandidates: [
        '何とかなりそうね',
        '何とかなりそう',
        '何とかなり',
        '何とかなる',
        '何とか'
      ]
    })

    expect(
      results.map(({ expression, matchedSurface }) => ({ expression, matchedSurface }))
    ).toEqual([
      { expression: '何とかなる', matchedSurface: '何とかなりそう' },
      { expression: '何とか', matchedSurface: '何とか' }
    ])
  })

  it('preserves candidate provenance through deduplication and frequency attachment', () => {
    const db = fakeLookupDb(['何とかなる', '何とか'], { 何とかなる: 9000, 何とか: 10 })

    const results = lookup(
      db,
      {
        lemma: '何とか',
        longestMatchCandidates: ['何とかなりそう', '何とかなる', '何とか']
      },
      { freqDictId: 99 }
    )

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      expression: '何とかなる',
      matchedSurface: '何とかなりそう',
      frequency: 9000
    })
    expect(results[1]).toMatchObject({
      expression: '何とか',
      matchedSurface: '何とか',
      frequency: 10
    })
  })

  function seedDb(): Database.Database {
    const db = new Database(':memory:')
    initSchema(db)

    const insertDict = db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    )
    const enabledDictId = Number(insertDict.run('Enabled Dict', '1.0', 1, 0).lastInsertRowid)
    const disabledDictId = Number(insertDict.run('Disabled Dict', '1.0', 0, 0).lastInsertRowid)

    const insertTerm = db.prepare(
      `INSERT INTO terms (dict_id, expression, reading, glossary, term_tags, rules, score, sequence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    // Direct lemma hit.
    insertTerm.run(enabledDictId, '猫', 'ねこ', 'cat', '', '', 0, 0)
    // Only reachable via deinflection: query lemma will be 食べた.
    insertTerm.run(enabledDictId, '食べる', 'たべる', 'to eat', '', 'v1', 0, 0)
    // Same expression present in the disabled dictionary too, to prove filtering.
    insertTerm.run(disabledDictId, '猫', 'ねこ', 'cat (disabled dict)', '', '', 0, 0)

    return db
  }

  it('finds a direct lemma hit', () => {
    const db = seedDb()
    const results = lookup(db, { lemma: '猫' })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      expression: '猫',
      reading: 'ねこ',
      dictTitle: 'Enabled Dict'
    })
    db.close()
  })

  it('ranks direct lemmas between compound candidates and intra-token prefixes', () => {
    const db = new Database(':memory:')
    initSchema(db)
    const dictId = Number(
      db
        .prepare(
          'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
        )
        .run('Test', '1', 1, 0).lastInsertRowid
    )
    const insert = db.prepare(
      'INSERT INTO terms (dict_id, expression, reading, glossary, sequence) VALUES (?, ?, ?, ?, ?)'
    )

    insert.run(dictId, '生き返る', 'いきかえる', 'revive', 0)
    insert.run(dictId, '生き', 'いき', 'freshness', 0)
    expect(
      lookup(db, {
        lemma: '生き返る',
        reading: 'いきかえった',
        surface: '生き返った',
        longestMatchCandidates: ['生き返った', '生き返っ', '生き返', '生き']
      }).map((result) => result.expression)
    ).toEqual(['生き返る', '生き'])

    insert.run(dictId, '何とかなる', 'なんとかなる', 'work out', 0)
    insert.run(dictId, '何とか', 'なんとか', 'somehow', 0)
    expect(
      lookup(db, {
        lemma: '何とか',
        surface: '何とか',
        longestMatchCandidates: [
          '何とかなりそう',
          '何とかなり',
          '何とかなる',
          '何とか',
          '何と',
          '何'
        ]
      }).map((result) => result.expression)
    ).toEqual(['何とかなる', '何とか'])

    insert.run(dictId, '行く', 'いく', 'go', 0)
    insert.run(dictId, '行き', 'いき', 'bound for', 0)
    expect(
      lookup(db, {
        lemma: '行く',
        reading: 'いく',
        surface: '行きたければ',
        longestMatchCandidates: ['行きたければ', '行きたけれ', '行きたけ', '行きた', '行き']
      }).map((result) => result.expression)
    ).toEqual(['行く', '行き'])

    expect(
      lookup(db, {
        lemma: '生き返る',
        reading: 'いきかえった',
        longestMatchCandidates: ['生き返った', '生き返っ', '生き返', '生き']
      }).map((result) => result.expression)
    ).toEqual(['生き', '生き返る'])
    db.close()
  })

  it('filters out disabled dictionaries', () => {
    const db = seedDb()
    const results = lookup(db, { lemma: '猫' })
    expect(results.every((r) => r.dictTitle !== 'Disabled Dict')).toBe(true)
    db.close()
  })

  it('matches hiragana and katakana readings while keeping an exact written match first', () => {
    const db = new Database(':memory:')
    initSchema(db)
    const dictId = Number(
      db
        .prepare(
          'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
        )
        .run('JMnedict', '1.0', 1, 0).lastInsertRowid
    )
    const insertTerm = db.prepare(
      'INSERT INTO terms (dict_id, expression, reading, glossary, sequence) VALUES (?, ?, ?, ?, ?)'
    )
    insertTerm.run(dictId, '悟空', 'ごくう', 'Goku', 0)
    insertTerm.run(dictId, '獄雨', 'ごくう', 'homophone', 0)

    const results = lookup(db, { lemma: '悟空', reading: 'ゴクウ' })

    expect(results.map((result) => result.expression)).toEqual(['悟空', '獄雨'])
    db.close()
  })

  it('falls back to deinflection when the surface itself has no direct hit', () => {
    const db = seedDb()
    const results = lookup(db, { lemma: '食べた' })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ expression: '食べる', glossary: 'to eat' })
    db.close()
  })

  it('returns an empty array for a genuine miss', () => {
    const db = seedDb()
    const results = lookup(db, { lemma: '存在しない単語' })
    expect(results).toEqual([])
    db.close()
  })

  it('prefers a longestMatchCandidates hit over the single-token lemma', () => {
    const db = seedDb()
    const insertDict = db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    )
    const dictId = Number(insertDict.run('Compound Dict', '1.0', 1, 0).lastInsertRowid)
    db.prepare(
      `INSERT INTO terms (dict_id, expression, reading, glossary, sequence)
       VALUES (?, ?, ?, ?, ?)`
    ).run(dictId, '閻魔大王', 'えんまだいおう', 'King Enma', 0)

    // Simulates a MeCab split of 閻魔大王 into 閻魔/大王: the clicked token's own
    // lemma (閻魔) has no direct hit, but the caller-supplied longest-match
    // candidate (the merged compound) does.
    const results = lookup(db, {
      lemma: '閻魔',
      longestMatchCandidates: ['閻魔大王']
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ expression: '閻魔大王', glossary: 'King Enma' })
    db.close()
  })

  it('prefers a kanji headword matched by the full kana surface over its shorter prefix', () => {
    const rows = {
      よかろう: [
        {
          expression: '良かろう',
          reading: 'よかろう',
          glossary: 'probably good',
          glossary_json: null,
          title: 'JPDBv2',
          dict_id: 1,
          styles_css: null,
          def_tags: '',
          term_tags: '',
          rules: '',
          score: 0
        }
      ],
      よか: [
        {
          expression: 'よか',
          reading: 'よか',
          glossary: 'good',
          glossary_json: null,
          title: 'JPDBv2',
          dict_id: 1,
          styles_css: null,
          def_tags: '',
          term_tags: '',
          rules: '',
          score: 0
        }
      ]
    }
    const db: LookupDb = {
      exec: () => undefined,
      prepare: () => ({
        all: (...params: unknown[]) => rows[params[0] as keyof typeof rows] ?? []
      })
    }

    const results = lookup(db, {
      lemma: '良い',
      reading: 'よかろう',
      longestMatchCandidates: ['よかろう', 'よか']
    })

    expect(results.map((result) => result.expression)).toEqual(['良かろう', 'よか'])
  })

  it('skips a missing candidate and uses the next one that hits', () => {
    const db = seedDb()
    const results = lookup(db, {
      lemma: '猫',
      longestMatchCandidates: ['存在しない候補', '猫']
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ expression: '猫' })
    db.close()
  })

  it('shows the compound match first, then the shorter single-token match below it', () => {
    const db = seedDb()
    const insertDict = db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    )
    const dictId = Number(insertDict.run('Compound Dict', '1.0', 1, 0).lastInsertRowid)
    const insertTerm = db.prepare(
      `INSERT INTO terms (dict_id, expression, reading, glossary, sequence) VALUES (?, ?, ?, ?, ?)`
    )
    // '（閻魔大王）うん？' bug: MeCab splits 閻魔大王 into 閻魔/大王. Both the
    // compound headword and the clicked token's own headword exist in the
    // dictionary, and both should come back -- longest first.
    insertTerm.run(dictId, '閻魔大王', 'えんまだいおう', 'King Enma', 0)
    insertTerm.run(dictId, '閻魔', 'えんま', 'Enma (the god)', 0)

    const results = lookup(db, {
      lemma: '閻魔',
      longestMatchCandidates: ['閻魔大王']
    })
    expect(results.map((r) => r.expression)).toEqual(['閻魔大王', '閻魔'])
    db.close()
  })

  it('tries every longestMatchCandidates hit, not just the first, longest first', () => {
    const db = seedDb()
    const insertDict = db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    )
    const dictId = Number(insertDict.run('Compound Dict', '1.0', 1, 0).lastInsertRowid)
    const insertTerm = db.prepare(
      `INSERT INTO terms (dict_id, expression, reading, glossary, sequence) VALUES (?, ?, ?, ?, ?)`
    )
    insertTerm.run(dictId, '大変申し訳', 'たいへんもうしわけ', '4-token compound', 0)
    insertTerm.run(dictId, '大変申', 'たいへんもう', '3-token compound', 0)
    // The 2-token candidate ('大変') is deliberately absent from the dictionary,
    // to prove a miss in the middle of the candidate list doesn't stop the rest
    // from being tried.

    const results = lookup(db, {
      lemma: '大',
      longestMatchCandidates: ['大変申し訳', '大変申', '大変']
    })
    expect(results.map((r) => r.expression)).toEqual(['大変申し訳', '大変申'])
    db.close()
  })

  it('dedupes a candidate hit that coincides with the direct lemma match', () => {
    const db = seedDb()
    const results = lookup(db, {
      lemma: '猫',
      longestMatchCandidates: ['猫']
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ expression: '猫', dictTitle: 'Enabled Dict' })
    db.close()
  })

  it('falls back to the normal lemma path when no longestMatchCandidates hit', () => {
    const db = seedDb()
    const results = lookup(db, {
      lemma: '猫',
      longestMatchCandidates: ['存在しない候補']
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ expression: '猫' })
    db.close()
  })

  it('carries dictId and a dictionary-bundled stylesCss through, and null when the dict has none', () => {
    const db = seedDb()
    const { id: dictId } = db
      .prepare('SELECT id FROM dictionaries WHERE title = ?')
      .get('Enabled Dict') as { id: number }

    const beforeResults = lookup(db, { lemma: '猫' })
    expect(beforeResults[0].dictId).toBe(dictId)
    expect(beforeResults[0].stylesCss).toBeNull()

    db.prepare('UPDATE dictionaries SET styles_css = ? WHERE id = ?').run(
      '[data-sc-content="pos"] { margin-right: 4px; }',
      dictId
    )

    const afterResults = lookup(db, { lemma: '猫' })
    expect(afterResults[0].stylesCss).toBe('[data-sc-content="pos"] { margin-right: 4px; }')

    db.close()
  })

  it('carries glossary_json through as glossaryJson, and null for rows that predate the column', () => {
    const db = seedDb()
    const { id: dictId } = db
      .prepare('SELECT id FROM dictionaries WHERE title = ?')
      .get('Enabled Dict') as { id: number }
    db.prepare(
      `INSERT INTO terms (dict_id, expression, reading, glossary, glossary_json, sequence)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(dictId, '構造', 'こうぞう', 'structure', '["structure"]', 0)

    const results = lookup(db, { lemma: '構造' })
    expect(results[0].glossaryJson).toBe('["structure"]')

    // '猫' was inserted via seedDb()'s column list, which omits glossary_json.
    const catResults = lookup(db, { lemma: '猫' })
    expect(catResults[0].glossaryJson).toBeNull()

    db.close()
  })
})

function makeResult(overrides: Partial<LookupResult>): LookupResult {
  return {
    expression: '猫',
    reading: 'ねこ',
    glossary: 'cat',
    dictTitle: 'Enabled Dict',
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

describe('attachFrequencies', () => {
  function seedFreqDb(): { db: Database.Database; freqDictId: number } {
    const db = new Database(':memory:')
    initSchema(db)
    const insertDict = db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    )
    const freqDictId = Number(insertDict.run('Freq Dict', '1.0', 1, 0).lastInsertRowid)

    const insertMeta = db.prepare(
      `INSERT INTO term_meta (dict_id, expression, reading, mode, value, display)
       VALUES (?, ?, ?, 'freq', ?, ?)`
    )
    // Reading-agnostic row for 猫.
    insertMeta.run(freqDictId, '猫', null, 100, '100')
    // Reading-scoped row for 猫/ねこ — should win over the agnostic row above.
    insertMeta.run(freqDictId, '猫', 'ねこ', 5, '5')

    return { db, freqDictId }
  }

  it('prefers a reading-scoped match over a reading-agnostic one', () => {
    const { db, freqDictId } = seedFreqDb()
    const results = [makeResult({ expression: '猫', reading: 'ねこ' })]
    const [attached] = attachFrequencies(db, results, freqDictId)
    expect(attached.frequency).toBe(5)
    expect(attached.frequencyDisplay).toBe('5')
    db.close()
  })

  it('falls back to a reading-agnostic match when no reading-scoped row exists', () => {
    const { db, freqDictId } = seedFreqDb()
    const results = [makeResult({ expression: '猫', reading: 'べつのよみ' })]
    const [attached] = attachFrequencies(db, results, freqDictId)
    expect(attached.frequency).toBe(100)
    expect(attached.frequencyDisplay).toBe('100')
    db.close()
  })

  it('returns null frequency/frequencyDisplay when no row matches', () => {
    const { db, freqDictId } = seedFreqDb()
    const results = [makeResult({ expression: '犬', reading: 'いぬ' })]
    const [attached] = attachFrequencies(db, results, freqDictId)
    expect(attached.frequency).toBeNull()
    expect(attached.frequencyDisplay).toBeNull()
    db.close()
  })

  it('does not mutate the input results array or its entries', () => {
    const { db, freqDictId } = seedFreqDb()
    const original = makeResult({ expression: '猫', reading: 'ねこ' })
    const results = [original]
    attachFrequencies(db, results, freqDictId)
    expect(original.frequency).toBeNull()
    db.close()
  })

  function countingFreqQueries(db: Database.Database): {
    db: Database.Database
    queryCount: () => number
  } {
    let count = 0
    const original = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      if (sql.includes('term_meta')) count += 1
      return original(sql)
    }) as typeof db.prepare
    return { db, queryCount: () => count }
  }

  it('does not duplicate queries for duplicate expressions', () => {
    const { db, freqDictId } = seedFreqDb()
    const { queryCount } = countingFreqQueries(db)
    const results = [
      makeResult({ expression: '猫', reading: 'ねこ' }),
      makeResult({ expression: '猫', reading: 'ねこ' }),
      makeResult({ expression: '猫', reading: 'ねこ' })
    ]
    attachFrequencies(db, results, freqDictId)
    expect(queryCount()).toBe(1)
    db.close()
  })

  it('chunks more than 400 unique expressions into ceil(unique / 400) queries', () => {
    const { db, freqDictId } = seedFreqDb()
    const { queryCount } = countingFreqQueries(db)
    // 401 unique expressions -> must be split across two chunked queries.
    const results = Array.from({ length: 401 }, (_, i) =>
      makeResult({ expression: `word-${i}`, reading: 'よみ' })
    )
    attachFrequencies(db, results, freqDictId)
    expect(queryCount()).toBe(2)
    db.close()
  })

  it('issues one query per chunk of unique expressions, independent of result count', () => {
    const { db, freqDictId } = seedFreqDb()
    const { queryCount } = countingFreqQueries(db)
    // 900 results but only 3 unique expressions -> a single chunk, one query.
    const results = Array.from({ length: 900 }, (_, i) =>
      makeResult({ expression: `word-${i % 3}`, reading: 'よみ' })
    )
    attachFrequencies(db, results, freqDictId)
    expect(queryCount()).toBe(1)
    db.close()
  })
})

describe('sortByFrequency', () => {
  it('rank-based mode puts the lower frequency value first (lower rank = more common)', () => {
    const a = makeResult({ expression: 'a', frequency: 50 })
    const b = makeResult({ expression: 'b', frequency: 5 })
    const sorted = sortByFrequency([a, b], 'rank-based')
    expect(sorted.map((r) => r.expression)).toEqual(['b', 'a'])
  })

  it('occurrence-based mode puts the higher frequency value first', () => {
    const a = makeResult({ expression: 'a', frequency: 50 })
    const b = makeResult({ expression: 'b', frequency: 5 })
    const sorted = sortByFrequency([a, b], 'occurrence-based')
    expect(sorted.map((r) => r.expression)).toEqual(['a', 'b'])
  })

  it('places null-frequency entries last, keeping their original relative order, regardless of mode', () => {
    const a = makeResult({ expression: 'a', frequency: null })
    const b = makeResult({ expression: 'b', frequency: 20 })
    const c = makeResult({ expression: 'c', frequency: null })
    const d = makeResult({ expression: 'd', frequency: 10 })
    const sortedRank = sortByFrequency([a, b, c, d], 'rank-based')
    expect(sortedRank.map((r) => r.expression)).toEqual(['d', 'b', 'a', 'c'])
    const sortedOccurrence = sortByFrequency([a, b, c, d], 'occurrence-based')
    expect(sortedOccurrence.map((r) => r.expression)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('does not mutate the input array', () => {
    const a = makeResult({ expression: 'a', frequency: 50 })
    const b = makeResult({ expression: 'b', frequency: 5 })
    const input = [a, b]
    sortByFrequency(input, 'rank-based')
    expect(input.map((r) => r.expression)).toEqual(['a', 'b'])
  })

  it('puts the longest expression first even when its frequency is worse (higher) than a shorter match', () => {
    // Reproduces the 閻魔大王 bug: the compound (long, rarer) must lead over
    // its shorter, more-common constituent once frequency sorting is on.
    const compound = makeResult({ expression: '閻魔大王', frequency: 8000 })
    const constituent = makeResult({ expression: '閻魔', frequency: 200 })
    const sorted = sortByFrequency([constituent, compound], 'rank-based')
    expect(sorted.map((r) => r.expression)).toEqual(['閻魔大王', '閻魔'])
  })

  it('breaks ties by frequency only within the same expression length', () => {
    const long = makeResult({ expression: '閻魔大王', frequency: 10 })
    const shortRare = makeResult({ expression: '閻魔', frequency: 500 })
    const shortCommon = makeResult({ expression: '閻魔', frequency: 50 })
    const shortest = makeResult({ expression: '閻', frequency: null })
    const sorted = sortByFrequency([shortRare, long, shortest, shortCommon], 'rank-based')
    expect(sorted.map((r) => r.expression)).toEqual(['閻魔大王', '閻魔', '閻魔', '閻'])
    expect(sorted[1].frequency).toBe(50)
    expect(sorted[2].frequency).toBe(500)
  })
})

describe('frequencyModeForDict', () => {
  it("defaults a dict with no frequency_mode override to 'rank-based'", () => {
    const db = new Database(':memory:')
    initSchema(db)
    const insertDict = db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    )
    const dictId = Number(insertDict.run('Rank Dict', '1.0', 1, 0).lastInsertRowid)

    expect(frequencyModeForDict(db, dictId)).toBe('rank-based')
    db.close()
  })

  it("reads an explicit 'occurrence-based' frequency_mode", () => {
    const db = new Database(':memory:')
    initSchema(db)
    const insertDict = db.prepare(
      `INSERT INTO dictionaries (title, revision, enabled, priority, frequency_mode)
       VALUES (?, ?, ?, ?, ?)`
    )
    const dictId = Number(
      insertDict.run('Occurrence Dict', '1.0', 1, 0, 'occurrence-based').lastInsertRowid
    )

    expect(frequencyModeForDict(db, dictId)).toBe('occurrence-based')
    db.close()
  })

  it('defaults to rank-based for a nonexistent dict id', () => {
    const db = new Database(':memory:')
    initSchema(db)
    expect(frequencyModeForDict(db, 999)).toBe('rank-based')
    db.close()
  })
})

describe('lookup with frequency options', () => {
  function seedFreqLookupDb(): { db: Database.Database; freqDictId: number } {
    const db = new Database(':memory:')
    initSchema(db)

    const insertDict = db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    )
    const dictA = Number(insertDict.run('Dict A', '1.0', 1, 0).lastInsertRowid)
    const dictB = Number(insertDict.run('Dict B', '1.0', 1, 1).lastInsertRowid)
    const freqDictId = Number(insertDict.run('Freq Dict', '1.0', 1, 2).lastInsertRowid)

    const insertTerm = db.prepare(
      `INSERT INTO terms (dict_id, expression, reading, glossary, term_tags, def_tags, rules, score, sequence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    // Lower priority dict (dictA, priority 0) comes first without freq sort.
    insertTerm.run(dictA, '猫', 'ねこ', 'cat (A)', 'tagA', 'defA', 'rule', 3, 0)
    insertTerm.run(dictB, '猫', 'ねこ', 'cat (B)', 'tagB', 'defB', 'rule', 7, 0)

    const insertMeta = db.prepare(
      `INSERT INTO term_meta (dict_id, expression, reading, mode, value, display)
       VALUES (?, ?, ?, 'freq', ?, ?)`
    )
    // dictB's entry is more common (lower value) than dictA's per the freq dict.
    insertMeta.run(freqDictId, '猫', null, 500, '500')

    return { db, freqDictId }
  }

  it('attaches frequency/frequencyDisplay and carries new fields when freqDictId is given', () => {
    const { db, freqDictId } = seedFreqLookupDb()
    const results = lookup(db, { lemma: '猫' }, { freqDictId })
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.frequency).toBe(500)
      expect(r.frequencyDisplay).toBe('500')
    }
    const dictAResult = results.find((r) => r.dictTitle === 'Dict A')
    expect(dictAResult).toMatchObject({
      defTags: 'defA',
      termTags: 'tagA',
      score: 3,
      rules: 'rule'
    })
    db.close()
  })

  it('ranks results by frequency within match groups without exposing ranking metadata', () => {
    const db = new Database(':memory:')
    initSchema(db)
    const insertDict = db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    )
    const firstDict = Number(insertDict.run('First', '1.0', 1, 0).lastInsertRowid)
    const secondDict = Number(insertDict.run('Second', '1.0', 1, 1).lastInsertRowid)
    const freqDictId = Number(insertDict.run('Frequency', '1.0', 1, 2).lastInsertRowid)
    const insertTerm = db.prepare(
      `INSERT INTO terms (dict_id, expression, reading, glossary, term_tags, score, sequence)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const insertFrequency = db.prepare(
      `INSERT INTO term_meta (dict_id, expression, reading, mode, value, display)
       VALUES (?, ?, ?, 'freq', ?, ?)`
    )

    insertTerm.run(firstDict, '事', 'こと', 'thing', '', 0, 0)
    insertTerm.run(secondDict, 'コト', 'こと', 'koto', '', 0, 0)
    insertFrequency.run(freqDictId, '事', 'こと', 15, '15')
    insertFrequency.run(freqDictId, 'コト', 'こと', 64790, '64790')
    expect(
      lookup(db, { lemma: 'こと', reading: 'こと' }, { freqDictId }).map(
        (result) => result.expression
      )
    ).toEqual(['事', 'コト'])

    insertTerm.run(firstDict, '故障', 'こしょう', 'failure', '', 0, 0)
    insertTerm.run(secondDict, 'コショー', 'こしょう', 'homophone', 'P', 99, 0)
    insertFrequency.run(freqDictId, '故障', 'こしょう', 900, '900')
    insertFrequency.run(freqDictId, 'コショー', 'こしょう', 1, '1')
    expect(
      lookup(db, { lemma: '故障', reading: 'こしょう' }, { freqDictId }).map(
        (result) => result.expression
      )
    ).toEqual(['コショー', '故障'])

    insertTerm.run(firstDict, '優先', 'ゆうせん', 'plain', '', 0, 0)
    insertTerm.run(secondDict, '優先', 'ゆうせん', 'common', 'news1', 0, 0)
    insertFrequency.run(freqDictId, '優先', 'ゆうせん', 10, '10')
    expect(lookup(db, { lemma: '優先' }, { freqDictId }).map((result) => result.glossary)).toEqual([
      'common',
      'plain'
    ])

    insertTerm.run(firstDict, '辞書順', 'じしょじゅん', 'first dictionary', '', 0, 0)
    insertTerm.run(secondDict, '辞書順', 'じしょじゅん', 'second dictionary', '', 0, 0)
    insertFrequency.run(freqDictId, '辞書順', 'じしょじゅん', 10, '10')
    expect(
      lookup(db, { lemma: '辞書順' }, { freqDictId }).map((result) => result.glossary)
    ).toEqual(['first dictionary', 'second dictionary'])

    insertTerm.run(firstDict, '閻魔大王', 'えんまだいおう', 'compound', '', 0, 0)
    insertTerm.run(secondDict, '閻魔', 'えんま', 'constituent', '', 0, 0)
    insertFrequency.run(freqDictId, '閻魔大王', 'えんまだいおう', 8000, '8000')
    insertFrequency.run(freqDictId, '閻魔', 'えんま', 200, '200')
    const compoundResults = lookup(
      db,
      { lemma: '閻魔', longestMatchCandidates: ['閻魔大王', '閻魔'] },
      { freqDictId }
    )
    expect(compoundResults.map((result) => result.expression)).toEqual(['閻魔大王', '閻魔'])
    expect(compoundResults[0]).not.toHaveProperty('matchGroup')
    db.close()
  })

  it('uses score before dictionary order when no frequency dictionary is selected', () => {
    const { db } = seedFreqLookupDb()
    const results = lookup(db, { lemma: '猫' })
    expect(results.map((r) => r.dictTitle)).toEqual(['Dict B', 'Dict A'])
    expect(results.every((r) => r.frequency === null && r.frequencyDisplay === null)).toBe(true)
    db.close()
  })

  it('sorts entries with differing frequency values ascending, more-common first', () => {
    const db = new Database(':memory:')
    initSchema(db)
    const insertDict = db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    )
    // Two dicts (so two entries), lower-priority (Dict Rare) listed first by
    // default priority order, but Dict Common should sort first by frequency.
    const dictRare = Number(insertDict.run('Dict Rare', '1.0', 1, 0).lastInsertRowid)
    const dictCommon = Number(insertDict.run('Dict Common', '1.0', 1, 1).lastInsertRowid)
    const freqDictId = Number(insertDict.run('Freq Dict', '1.0', 1, 2).lastInsertRowid)

    const insertTerm = db.prepare(
      `INSERT INTO terms (dict_id, expression, reading, glossary, sequence) VALUES (?, ?, ?, ?, ?)`
    )
    insertTerm.run(dictRare, '猫', 'ねこ', 'cat (rare entry)', 0)
    insertTerm.run(dictCommon, '猫', 'べつ', 'cat (common entry)', 0)

    const insertMeta = db.prepare(
      `INSERT INTO term_meta (dict_id, expression, reading, mode, value, display)
       VALUES (?, ?, ?, 'freq', ?, ?)`
    )
    insertMeta.run(freqDictId, '猫', 'ねこ', 900, '900')
    insertMeta.run(freqDictId, '猫', 'べつ', 1, '1')

    const results = lookup(db, { lemma: '猫' }, { freqDictId })
    expect(results.map((r) => r.glossary)).toEqual(['cat (common entry)', 'cat (rare entry)'])
    db.close()
  })

  it("honors an explicit options.sortMode override even against the freq dict's own frequency_mode", () => {
    const db = new Database(':memory:')
    initSchema(db)
    const insertDict = db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    )
    const dictRare = Number(insertDict.run('Dict Rare', '1.0', 1, 0).lastInsertRowid)
    const dictCommon = Number(insertDict.run('Dict Common', '1.0', 1, 1).lastInsertRowid)
    // This dict is rank-based by default (no frequency_mode override), but the
    // caller-supplied sortMode below should still force occurrence-based order.
    const freqDictId = Number(insertDict.run('Freq Dict', '1.0', 1, 2).lastInsertRowid)

    const insertTerm = db.prepare(
      `INSERT INTO terms (dict_id, expression, reading, glossary, sequence) VALUES (?, ?, ?, ?, ?)`
    )
    insertTerm.run(dictRare, '猫', 'ねこ', 'cat (rare entry)', 0)
    insertTerm.run(dictCommon, '猫', 'べつ', 'cat (common entry)', 0)

    const insertMeta = db.prepare(
      `INSERT INTO term_meta (dict_id, expression, reading, mode, value, display)
       VALUES (?, ?, ?, 'freq', ?, ?)`
    )
    // Higher value = more common for an occurrence dictionary.
    insertMeta.run(freqDictId, '猫', 'ねこ', 1, '1')
    insertMeta.run(freqDictId, '猫', 'べつ', 900, '900')

    const results = lookup(db, { lemma: '猫' }, { freqDictId, sortMode: 'occurrence-based' })
    expect(results.map((r) => r.glossary)).toEqual(['cat (common entry)', 'cat (rare entry)'])
    db.close()
  })

  it('sorts entries descending, more-common first, when the freq dict is occurrence-based', () => {
    const db = new Database(':memory:')
    initSchema(db)
    const insertDict = db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    )
    const dictRare = Number(insertDict.run('Dict Rare', '1.0', 1, 0).lastInsertRowid)
    const dictCommon = Number(insertDict.run('Dict Common', '1.0', 1, 1).lastInsertRowid)
    const insertOccurrenceDict = db.prepare(
      `INSERT INTO dictionaries (title, revision, enabled, priority, frequency_mode)
       VALUES (?, ?, ?, ?, ?)`
    )
    const freqDictId = Number(
      insertOccurrenceDict.run('Occurrence Freq Dict', '1.0', 1, 2, 'occurrence-based')
        .lastInsertRowid
    )

    const insertTerm = db.prepare(
      `INSERT INTO terms (dict_id, expression, reading, glossary, sequence) VALUES (?, ?, ?, ?, ?)`
    )
    insertTerm.run(dictRare, '猫', 'ねこ', 'cat (rare entry)', 0)
    insertTerm.run(dictCommon, '猫', 'べつ', 'cat (common entry)', 0)

    const insertMeta = db.prepare(
      `INSERT INTO term_meta (dict_id, expression, reading, mode, value, display)
       VALUES (?, ?, ?, 'freq', ?, ?)`
    )
    // Higher value = more common for this occurrence dictionary.
    insertMeta.run(freqDictId, '猫', 'ねこ', 1, '1')
    insertMeta.run(freqDictId, '猫', 'べつ', 900, '900')

    const results = lookup(db, { lemma: '猫' }, { freqDictId })
    expect(results.map((r) => r.glossary)).toEqual(['cat (common entry)', 'cat (rare entry)'])
    db.close()
  })
})
