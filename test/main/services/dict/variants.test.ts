import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@src/main/services/dict/schema'
import { spellingVariants } from '@src/main/services/dict/variants'

function dbWith(
  terms: Array<[expression: string, reading: string, sequence: number, dictId?: number]>,
  disabledDicts: number[] = []
): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  for (const id of [1, 2]) {
    db.prepare('INSERT INTO dictionaries (id, title, enabled) VALUES (?, ?, ?)').run(
      id,
      `Dict ${id}`,
      disabledDicts.includes(id) ? 0 : 1
    )
  }
  const insert = db.prepare(
    'INSERT INTO terms (dict_id, expression, reading, sequence) VALUES (?, ?, ?, ?)'
  )
  for (const [expression, reading, sequence, dictId = 1] of terms)
    insert.run(dictId, expression, reading, sequence)
  return db
}

describe('spellingVariants', () => {
  it('maps a lemma to the other spellings of its entry', () => {
    const db = dbWith([
      ['お主', 'おぬし', 100],
      ['御主', 'おぬし', 100],
      ['主', 'ぬし', 101]
    ])

    expect(spellingVariants(db, ['お主', '主', '無い'])).toEqual({ お主: ['御主'] })
  })

  it('skips lemmas that belong to several entries of one dictionary', () => {
    const db = dbWith([
      ['かける', 'かける', 1],
      ['掛ける', 'かける', 1],
      ['かける', 'かける', 2],
      ['賭ける', 'かける', 2]
    ])

    expect(spellingVariants(db, ['かける'])).toEqual({})
  })

  it('ignores unsequenced rows and disabled dictionaries', () => {
    const db = dbWith(
      [
        ['甲', 'こう', 0],
        ['乙', 'こう', 0],
        ['お主', 'おぬし', 100, 2],
        ['御主', 'おぬし', 100, 2]
      ],
      [2]
    )

    expect(spellingVariants(db, ['甲', 'お主'])).toEqual({})
  })
})
