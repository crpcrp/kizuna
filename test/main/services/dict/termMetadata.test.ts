import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@src/main/services/dict/schema'
import {
  attachFrequencies,
  attachPitchAccents,
  frequencyModeForDict
} from '@src/main/services/dict/termMetadata'
import type { LookupResult } from '@src/shared/dictionary'

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

function makePitchResult(overrides: Partial<LookupResult>): LookupResult {
  return {
    expression: '橋',
    reading: 'はし',
    glossary: 'bridge',
    dictTitle: 'Pitch Dict',
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

/**
 * Two dictionaries, each with its own pitch metadata for 橋, plus a
 * reading-agnostic row and a reading-scoped one for 猫 in dictionary 1.
 */
function seedPitchDb(): { db: Database.Database; dictA: number; dictB: number } {
  const db = new Database(':memory:')
  initSchema(db)
  const insertDict = db.prepare(
    'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
  )
  const dictA = Number(insertDict.run('Dict A', '1.0', 1, 0).lastInsertRowid)
  const dictB = Number(insertDict.run('Dict B', '1.0', 1, 1).lastInsertRowid)

  const insertPitch = db.prepare(
    `INSERT INTO term_meta (dict_id, expression, reading, mode, value, display, pitch_positions)
     VALUES (?, ?, ?, 'pitch', NULL, NULL, ?)`
  )
  insertPitch.run(dictA, '橋', 'はし', '[2]')
  insertPitch.run(dictB, '橋', 'はし', '[9]')
  // Reading-agnostic row, plus a reading-scoped one that must win for ねこ.
  insertPitch.run(dictA, '猫', null, '[7]')
  insertPitch.run(dictA, '猫', 'ねこ', '[1]')

  return { db, dictA, dictB }
}

describe('attachPitchAccents', () => {
  it('prefers a reading-scoped match over a reading-agnostic one', () => {
    const { db, dictA } = seedPitchDb()
    const [attached] = attachPitchAccents(db, [
      makePitchResult({ expression: '猫', reading: 'ねこ', dictId: dictA })
    ])
    expect(attached.pitchAccent).toEqual([1])
    db.close()
  })

  it('falls back to a reading-agnostic row when no reading-scoped row exists', () => {
    const { db, dictA } = seedPitchDb()
    const [attached] = attachPitchAccents(db, [
      makePitchResult({ expression: '猫', reading: 'べつのよみ', dictId: dictA })
    ])
    expect(attached.pitchAccent).toEqual([7])
    db.close()
  })

  it('matches a katakana result reading against a hiragana pitch reading', () => {
    const { db, dictA } = seedPitchDb()
    const [attached] = attachPitchAccents(db, [
      makePitchResult({ expression: '猫', reading: 'ネコ', dictId: dictA })
    ])
    expect(attached.pitchAccent).toEqual([1])
    db.close()
  })

  it('uses the first enabled pitch dictionary by priority, even for another dictionary’s result', () => {
    const { db, dictA, dictB } = seedPitchDb()
    const attached = attachPitchAccents(db, [
      makePitchResult({ dictId: dictA }),
      makePitchResult({ dictId: dictB })
    ])
    expect(attached.map((r) => r.pitchAccent)).toEqual([[2], [2]])
    db.close()
  })

  it('ignores pitch metadata from a disabled dictionary', () => {
    const { db, dictB } = seedPitchDb()
    db.prepare('UPDATE dictionaries SET enabled = 0 WHERE id = ?').run(dictB)
    const [attached] = attachPitchAccents(db, [makePitchResult({ dictId: dictB })])
    expect(attached.pitchAccent).toEqual([2])
    db.close()
  })

  it('ignores a stored value that is not a JSON array of non-negative integers', () => {
    const { db, dictA } = seedPitchDb()
    db.prepare(
      `INSERT INTO term_meta (dict_id, expression, reading, mode, pitch_positions)
       VALUES (?, '犬', 'いぬ', 'pitch', 'not-json')`
    ).run(dictA)
    const [attached] = attachPitchAccents(db, [
      makePitchResult({ expression: '犬', reading: 'いぬ', dictId: dictA })
    ])
    expect(attached.pitchAccent).toBeNull()
    db.close()
  })

  it('issues one batched query for several expressions across dictionaries', () => {
    const { db, dictA, dictB } = seedPitchDb()
    let pitchQueries = 0
    const original = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      if (sql.includes("mode = 'pitch'")) pitchQueries += 1
      return original(sql)
    }) as typeof db.prepare

    attachPitchAccents(db, [
      makePitchResult({ expression: '橋', dictId: dictA }),
      makePitchResult({ expression: '橋', dictId: dictB }),
      makePitchResult({ expression: '猫', reading: 'ねこ', dictId: dictA })
    ])

    expect(pitchQueries).toBe(1)
    db.close()
  })

  // Regression guard. The query must preserve the term-meta index while
  // allowing a separate, metadata-only pitch dictionary to enrich a result.
  it('uses idx_term_meta_expr rather than scanning term_meta', () => {
    const { db, dictA, dictB } = seedPitchDb()
    let plannedSql: string | null = null
    const original = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      if (sql.includes("mode = 'pitch'")) plannedSql = sql
      return original(sql)
    }) as typeof db.prepare

    attachPitchAccents(db, [makePitchResult({ dictId: dictA }), makePitchResult({ dictId: dictB })])

    expect(plannedSql).not.toBeNull()
    const plan = original(`EXPLAIN QUERY PLAN ${plannedSql}`)
      .all('橋')
      .map((row) => (row as { detail: string }).detail)
      .join('\n')
    expect(plan).toContain('idx_term_meta_expr')
    expect(plan).not.toContain('SCAN term_meta')

    db.close()
  })

  it('does not mutate the input results or their entries', () => {
    const { db, dictA } = seedPitchDb()
    const original = makePitchResult({ dictId: dictA })
    attachPitchAccents(db, [original])
    expect(original.pitchAccent).toBeNull()
    db.close()
  })
})
