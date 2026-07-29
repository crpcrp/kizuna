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

  it('backfills pitch_positions on a term_meta table that predates the column, keeping existing rows', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE term_meta (
      id INTEGER PRIMARY KEY,
      dict_id INTEGER NOT NULL,
      expression TEXT NOT NULL,
      reading TEXT,
      mode TEXT NOT NULL,
      value INTEGER,
      display TEXT
    )`)
    db.prepare(
      "INSERT INTO term_meta (id, dict_id, expression, mode, value) VALUES (1, 1, ?, 'freq', 42)"
    ).run('猫')

    initSchema(db)

    expect(columnNames(db, 'term_meta')).toContain('pitch_positions')
    const row = db.prepare('SELECT expression, value, pitch_positions FROM term_meta').get() as {
      expression: string
      value: number
      pitch_positions: string | null
    }
    expect(row).toEqual({ expression: '猫', value: 42, pitch_positions: null })

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

  it('backfills schema_version on a dictionaries table that predates the column, keeping existing rows', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE dictionaries (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      revision TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0
    )`)
    db.prepare('INSERT INTO dictionaries (id, title) VALUES (1, ?)').run('Old Dict')

    initSchema(db)

    expect(columnNames(db, 'dictionaries')).toContain('schema_version')
    const row = db.prepare('SELECT title, schema_version FROM dictionaries WHERE id = 1').get() as {
      title: string
      schema_version: number
    }
    expect(row.title).toBe('Old Dict')
    expect(row.schema_version).toBe(0)

    db.close()
  })

  it('backfills def_tags on a terms table that predates the column, keeping existing rows', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE terms (
      id INTEGER PRIMARY KEY,
      dict_id INTEGER NOT NULL,
      expression TEXT NOT NULL,
      reading TEXT,
      glossary TEXT,
      term_tags TEXT,
      rules TEXT,
      score INTEGER,
      sequence INTEGER
    )`)
    db.prepare('INSERT INTO terms (id, dict_id, expression) VALUES (1, 1, ?)').run('猫')

    initSchema(db)

    expect(columnNames(db, 'terms')).toContain('def_tags')
    const row = db.prepare('SELECT expression, def_tags FROM terms WHERE id = 1').get() as {
      expression: string
      def_tags: string | null
    }
    expect(row.expression).toBe('猫')
    expect(row.def_tags).toBeNull()

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

  it('backfills frequency_mode on a dictionaries table that predates the column, keeping existing rows', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE dictionaries (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      revision TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 0
    )`)
    db.prepare('INSERT INTO dictionaries (id, title) VALUES (1, ?)').run('Old Dict')

    initSchema(db)

    expect(columnNames(db, 'dictionaries')).toContain('frequency_mode')
    const row = db.prepare('SELECT title, frequency_mode FROM dictionaries WHERE id = 1').get() as {
      title: string
      frequency_mode: string
    }
    expect(row.title).toBe('Old Dict')
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

  it('backfills fallback_only on a dictionaries table that predates the column', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE dictionaries (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      revision TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 0,
      frequency_mode TEXT NOT NULL DEFAULT 'rank-based',
      styles_css TEXT
    )`)
    db.prepare('INSERT INTO dictionaries (id, title) VALUES (1, ?)').run('Old Dict')

    initSchema(db)

    const row = db.prepare('SELECT fallback_only FROM dictionaries WHERE id = 1').get() as {
      fallback_only: number
    }
    expect(row.fallback_only).toBe(0)

    db.close()
  })

  it('backfills styles_css on a dictionaries table that predates the column, keeping existing rows', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE dictionaries (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      revision TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 0,
      frequency_mode TEXT NOT NULL DEFAULT 'rank-based'
    )`)
    db.prepare('INSERT INTO dictionaries (id, title) VALUES (1, ?)').run('Old Dict')

    initSchema(db)

    expect(columnNames(db, 'dictionaries')).toContain('styles_css')
    const row = db.prepare('SELECT title, styles_css FROM dictionaries WHERE id = 1').get() as {
      title: string
      styles_css: string | null
    }
    expect(row.title).toBe('Old Dict')
    expect(row.styles_css).toBeNull()

    db.close()
  })

  it('backfills glossary_json on a terms table that predates the column, keeping existing rows', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE terms (
      id INTEGER PRIMARY KEY,
      dict_id INTEGER NOT NULL,
      expression TEXT NOT NULL,
      reading TEXT,
      glossary TEXT,
      term_tags TEXT,
      def_tags TEXT,
      rules TEXT,
      score INTEGER,
      sequence INTEGER
    )`)
    db.prepare('INSERT INTO terms (id, dict_id, expression) VALUES (1, 1, ?)').run('猫')

    initSchema(db)

    expect(columnNames(db, 'terms')).toContain('glossary_json')
    const row = db.prepare('SELECT expression, glossary_json FROM terms WHERE id = 1').get() as {
      expression: string
      glossary_json: string | null
    }
    expect(row.expression).toBe('猫')
    expect(row.glossary_json).toBeNull()

    db.close()
  })
})
