import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema, CURRENT_DICT_SCHEMA_VERSION } from '@src/main/services/dict/schema'

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
  it('creates the dictionaries and terms tables', () => {
    const db = new Database(':memory:')
    initSchema(db)

    const tables = tableNames(db)
    expect(tables).toContain('dictionaries')
    expect(tables).toContain('terms')

    db.close()
  })

  it('creates the expression and reading indexes on terms', () => {
    const db = new Database(':memory:')
    initSchema(db)

    const indexes = indexNames(db)
    expect(indexes).toContain('idx_terms_expression')
    expect(indexes).toContain('idx_terms_reading')

    db.close()
  })

  it('is idempotent — calling initSchema twice does not throw', () => {
    const db = new Database(':memory:')
    initSchema(db)

    expect(() => initSchema(db)).not.toThrow()

    db.close()
  })

  it('creates the term_meta table with its dict_id/expression index', () => {
    const db = new Database(':memory:')
    initSchema(db)

    expect(tableNames(db)).toContain('term_meta')
    expect(indexNames(db)).toContain('idx_term_meta_expr')
    expect(columnNames(db, 'term_meta')).toEqual([
      'id',
      'dict_id',
      'expression',
      'reading',
      'mode',
      'value',
      'display',
      'pitch_positions'
    ])

    db.close()
  })

  it('adds a def_tags column to terms', () => {
    const db = new Database(':memory:')
    initSchema(db)

    expect(columnNames(db, 'terms')).toContain('def_tags')

    db.close()
  })

  it('adds a schema_version column to dictionaries, defaulting to 0', () => {
    const db = new Database(':memory:')
    initSchema(db)

    expect(columnNames(db, 'dictionaries')).toContain('schema_version')
    expect(CURRENT_DICT_SCHEMA_VERSION).toBe(4)

    db.close()
  })

  it('adds a glossary_json column to terms', () => {
    const db = new Database(':memory:')
    initSchema(db)

    expect(columnNames(db, 'terms')).toContain('glossary_json')

    db.close()
  })

  it('adds a frequency_mode column to dictionaries, defaulting to rank-based', () => {
    const db = new Database(':memory:')
    initSchema(db)

    expect(columnNames(db, 'dictionaries')).toContain('frequency_mode')
    db.prepare('INSERT INTO dictionaries (id, title) VALUES (1, ?)').run('New Dict')
    const row = db.prepare('SELECT frequency_mode FROM dictionaries WHERE id = 1').get() as {
      frequency_mode: string
    }
    expect(row.frequency_mode).toBe('rank-based')

    db.close()
  })

  it('adds a styles_css column to dictionaries', () => {
    const db = new Database(':memory:')
    initSchema(db)

    expect(columnNames(db, 'dictionaries')).toContain('styles_css')

    db.close()
  })

  it('adds a fallback_only column to dictionaries, defaulting to 0', () => {
    const db = new Database(':memory:')
    initSchema(db)

    expect(columnNames(db, 'dictionaries')).toContain('fallback_only')
    db.prepare('INSERT INTO dictionaries (id, title) VALUES (1, ?)').run('New Dict')
    const row = db.prepare('SELECT fallback_only FROM dictionaries WHERE id = 1').get() as {
      fallback_only: number
    }
    expect(row.fallback_only).toBe(0)

    db.close()
  })
})
