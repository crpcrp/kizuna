import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@src/main/services/dict/schema'
import { attachPitchAccents, lookup } from '@src/main/services/dict/lookup'
import type { LookupResult } from '@src/shared/dictionary'

function makeResult(overrides: Partial<LookupResult>): LookupResult {
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
      makeResult({ expression: '猫', reading: 'ねこ', dictId: dictA })
    ])
    expect(attached.pitchAccent).toEqual([1])
    db.close()
  })

  it('falls back to a reading-agnostic row when no reading-scoped row exists', () => {
    const { db, dictA } = seedPitchDb()
    const [attached] = attachPitchAccents(db, [
      makeResult({ expression: '猫', reading: 'べつのよみ', dictId: dictA })
    ])
    expect(attached.pitchAccent).toEqual([7])
    db.close()
  })

  it('matches a katakana result reading against a hiragana pitch reading', () => {
    const { db, dictA } = seedPitchDb()
    const [attached] = attachPitchAccents(db, [
      makeResult({ expression: '猫', reading: 'ネコ', dictId: dictA })
    ])
    expect(attached.pitchAccent).toEqual([1])
    db.close()
  })

  it('uses the first enabled pitch dictionary by priority, even for another dictionary’s result', () => {
    const { db, dictA, dictB } = seedPitchDb()
    const attached = attachPitchAccents(db, [
      makeResult({ dictId: dictA }),
      makeResult({ dictId: dictB })
    ])
    expect(attached.map((r) => r.pitchAccent)).toEqual([[2], [2]])
    db.close()
  })

  it('ignores pitch metadata from a disabled dictionary', () => {
    const { db, dictB } = seedPitchDb()
    db.prepare('UPDATE dictionaries SET enabled = 0 WHERE id = ?').run(dictB)
    const [attached] = attachPitchAccents(db, [makeResult({ dictId: dictB })])
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
      makeResult({ expression: '犬', reading: 'いぬ', dictId: dictA })
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
      makeResult({ expression: '橋', dictId: dictA }),
      makeResult({ expression: '橋', dictId: dictB }),
      makeResult({ expression: '猫', reading: 'ねこ', dictId: dictA })
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

    attachPitchAccents(db, [makeResult({ dictId: dictA }), makeResult({ dictId: dictB })])

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
    const original = makeResult({ dictId: dictA })
    attachPitchAccents(db, [original])
    expect(original.pitchAccent).toBeNull()
    db.close()
  })
})

describe('lookup pitch enrichment', () => {
  /** Two term dictionaries, plus separate frequency and metadata-only pitch dictionaries. */
  function seedLookupDb(): { db: Database.Database; freqDictId: number } {
    const db = new Database(':memory:')
    initSchema(db)
    const insertDict = db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    )
    const dictA = Number(insertDict.run('Dict A', '1.0', 1, 0).lastInsertRowid)
    const dictB = Number(insertDict.run('Dict B', '1.0', 1, 1).lastInsertRowid)
    const pitchDictId = Number(insertDict.run('Pitch Dict', '1.0', 1, 2).lastInsertRowid)
    const freqDictId = Number(insertDict.run('Freq Dict', '1.0', 1, 3).lastInsertRowid)

    const insertTerm = db.prepare(
      `INSERT INTO terms (dict_id, expression, reading, glossary, term_tags, def_tags, rules, score, sequence)
       VALUES (?, ?, ?, ?, '', '', '', 0, 0)`
    )
    insertTerm.run(dictA, '猫', 'ねこ', 'cat (A)')
    insertTerm.run(dictB, '猫', 'ねこ', 'cat (B)')

    db.prepare(
      `INSERT INTO term_meta (dict_id, expression, reading, mode, value, display)
       VALUES (?, '猫', NULL, 'freq', 500, '500')`
    ).run(freqDictId)
    // This pitch dictionary deliberately has no term row; that is the normal
    // Yomitan pitch-dictionary shape. Its metadata still enriches both results.
    db.prepare(
      `INSERT INTO term_meta (dict_id, expression, reading, mode, pitch_positions)
       VALUES (?, '猫', 'ねこ', 'pitch', '[1]')`
    ).run(pitchDictId)
    // A lower-priority enabled dictionary's value must not win.
    db.prepare(
      `INSERT INTO term_meta (dict_id, expression, reading, mode, pitch_positions)
       VALUES (?, '猫', 'ねこ', 'pitch', '[99]')`
    ).run(freqDictId)

    return { db, freqDictId }
  }

  it('attaches metadata-only pitch-dictionary data to every displayed result', () => {
    const { db, freqDictId } = seedLookupDb()
    const results = lookup(db, { lemma: '猫' }, { freqDictId })
    expect(
      results.map((r) => ({ title: r.dictTitle, pitch: r.pitchAccent, frequency: r.frequency }))
    ).toEqual([
      { title: 'Dict A', pitch: [1], frequency: 500 },
      { title: 'Dict B', pitch: [1], frequency: 500 }
    ])
    db.close()
  })

  it('leaves ranking and frequency output unchanged when pitch data exists', () => {
    const { db, freqDictId } = seedLookupDb()
    const withPitch = lookup(db, { lemma: '猫' }, { freqDictId })

    db.prepare("DELETE FROM term_meta WHERE mode = 'pitch'").run()
    const withoutPitch = lookup(db, { lemma: '猫' }, { freqDictId })

    expect(withPitch.map((r) => ({ ...r, pitchAccent: null }))).toEqual(withoutPitch)
    db.close()
  })

  it('returns null pitchAccent when no dictionary ships pitch metadata', () => {
    const { db } = seedLookupDb()
    db.prepare("DELETE FROM term_meta WHERE mode = 'pitch'").run()
    expect(lookup(db, { lemma: '猫' }).map((r) => r.pitchAccent)).toEqual([null, null])
    db.close()
  })
})
