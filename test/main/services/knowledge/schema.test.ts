import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema, CURRENT_KNOWLEDGE_SCHEMA_VERSION } from '@src/main/services/knowledge/schema'

function columnNames(db: Database.Database, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => (row as { name: string }).name)
}

function tableNames(db: Database.Database): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => (row as { name: string }).name)
}

function indexNames(db: Database.Database): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((row) => (row as { name: string }).name)
}

describe('initSchema', () => {
  it('creates the known_words and sync_state tables', () => {
    const db = new Database(':memory:')
    initSchema(db)

    const tables = tableNames(db)
    expect(tables).toContain('known_words')
    expect(tables).toContain('sync_state')

    db.close()
  })

  it('creates the known_words table with the expected columns', () => {
    const db = new Database(':memory:')
    initSchema(db)

    expect(columnNames(db, 'known_words')).toEqual([
      'source',
      'lemma',
      'reading',
      'level',
      'srs_stage',
      'metadata_json',
      'updated_at'
    ])

    db.close()
  })

  it('creates the sync_state table with the expected columns', () => {
    const db = new Database(':memory:')
    initSchema(db)

    expect(columnNames(db, 'sync_state')).toEqual(['source', 'last_sync_at', 'cursor'])

    db.close()
  })

  it('creates the lemma index on known_words', () => {
    const db = new Database(':memory:')
    initSchema(db)

    expect(indexNames(db)).toContain('idx_known_lemma')

    db.close()
  })

  it('is idempotent — calling initSchema twice does not throw', () => {
    const db = new Database(':memory:')
    initSchema(db)

    expect(() => initSchema(db)).not.toThrow()

    db.close()
  })

  it('adds nullable metadata_json to a database created before provenance storage', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE known_words (
        source TEXT NOT NULL,
        lemma TEXT NOT NULL,
        reading TEXT NOT NULL DEFAULT '',
        level TEXT NOT NULL,
        srs_stage INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source, lemma, reading)
      )
    `)

    initSchema(db)

    expect(columnNames(db, 'known_words')).toContain('metadata_json')
    expect(
      db
        .prepare(
          `INSERT INTO known_words (source, lemma, reading, level, updated_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run('wanikani', '猫', 'ねこ', 'known', '2026-07-11T00:00:00.000Z')
    ).toBeDefined()
    db.close()
  })

  it('enforces (source, lemma, reading) as the primary key', () => {
    const db = new Database(':memory:')
    initSchema(db)

    db.prepare(
      `INSERT INTO known_words (source, lemma, reading, level, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('wanikani', '猫', 'ねこ', 'known', '2026-01-01T00:00:00.000Z')

    expect(() =>
      db
        .prepare(
          `INSERT INTO known_words (source, lemma, reading, level, updated_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run('wanikani', '猫', 'ねこ', 'wellKnown', '2026-01-02T00:00:00.000Z')
    ).toThrow()

    db.close()
  })

  it('exposes the current schema version', () => {
    expect(CURRENT_KNOWLEDGE_SCHEMA_VERSION).toBe(2)
  })
})
