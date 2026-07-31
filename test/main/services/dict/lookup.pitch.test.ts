import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@src/main/services/dict/schema'
import { lookup } from '@src/main/services/dict/lookup'

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
