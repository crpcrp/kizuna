// SQLite schema for the knowledge DB (`knowledge.db`, kept separate from
// the dictionary DB `dict.db` since they have unrelated lifecycles). Same
// idiom as services/dict/schema.ts: pure DDL strings + an idempotent
// `initSchema(db)`. The DB handle is injected so tests use an in-memory
// better-sqlite3 instance.

/** Structural subset of better-sqlite3's `Database` this module needs. */
export interface DbLike {
  exec(sql: string): unknown
  prepare(sql: string): { all(): unknown[] }
}

/** Bump when the on-disk schema shape changes. */
export const CURRENT_KNOWLEDGE_SCHEMA_VERSION = 2

export const CREATE_KNOWN_WORDS_TABLE = `
CREATE TABLE IF NOT EXISTS known_words (
  source     TEXT NOT NULL,
  lemma      TEXT NOT NULL,
  reading    TEXT NOT NULL DEFAULT '',
  level      TEXT NOT NULL,
  srs_stage  INTEGER,
  metadata_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, lemma, reading)
)`

export const CREATE_KNOWN_LEMMA_INDEX = `
CREATE INDEX IF NOT EXISTS idx_known_lemma ON known_words (lemma)`

export const CREATE_SYNC_STATE_TABLE = `
CREATE TABLE IF NOT EXISTS sync_state (
  source       TEXT PRIMARY KEY,
  last_sync_at TEXT,
  cursor       TEXT
)`

/** All DDL statements, in dependency order (tables before their indexes). */
export const SCHEMA_STATEMENTS = [
  CREATE_KNOWN_WORDS_TABLE,
  CREATE_SYNC_STATE_TABLE,
  CREATE_KNOWN_LEMMA_INDEX
]

/**
 * Columns added to existing tables after their initial release. `CREATE TABLE
 * IF NOT EXISTS` does not alter existing databases, so these additions are
 * backfilled through the same idiom as dict/schema.ts's COLUMN_MIGRATIONS.
 */
const COLUMN_MIGRATIONS: Array<{ table: string; column: string; addColumnSql: string }> = [
  {
    table: 'known_words',
    column: 'metadata_json',
    addColumnSql: 'ALTER TABLE known_words ADD COLUMN metadata_json TEXT'
  }
]

function existingColumns(db: DbLike, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

/**
 * Creates the known_words/sync_state tables and lookup index on `db` if they
 * don't already exist, then backfills any columns from `COLUMN_MIGRATIONS`
 * that a pre-existing table is missing. Idempotent — safe to call on every
 * startup.
 */
export function initSchema(db: DbLike): void {
  for (const statement of SCHEMA_STATEMENTS) {
    db.exec(statement)
  }
  for (const { table, column, addColumnSql } of COLUMN_MIGRATIONS) {
    if (!existingColumns(db, table).has(column)) {
      db.exec(addColumnSql)
    }
  }
}
