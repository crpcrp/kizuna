// SQLite schema for the knowledge DB (`knowledge.db`, kept separate from
// the dictionary DB `dict.db` since they have unrelated lifecycles). Same
// idiom as services/dict/schema.ts: pure DDL strings + an idempotent
// `initSchema(db)`. The DB handle is injected so tests use an in-memory
// better-sqlite3 instance.

/** Structural subset of better-sqlite3's `Database` this module needs. */
export interface DbLike {
  exec(sql: string): unknown
}

const CREATE_KNOWN_WORDS_TABLE = `
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

const CREATE_KNOWN_LEMMA_INDEX = `
CREATE INDEX IF NOT EXISTS idx_known_lemma ON known_words (lemma)`

const CREATE_SYNC_STATE_TABLE = `
CREATE TABLE IF NOT EXISTS sync_state (
  source       TEXT PRIMARY KEY,
  last_sync_at TEXT,
  cursor       TEXT
)`

/** All DDL statements, in dependency order (tables before their indexes). */
const SCHEMA_STATEMENTS = [
  CREATE_KNOWN_WORDS_TABLE,
  CREATE_SYNC_STATE_TABLE,
  CREATE_KNOWN_LEMMA_INDEX
]

/**
 * Creates the known_words/sync_state tables and lookup index on `db` if they
 * don't already exist. Idempotent — safe to call on every startup.
 */
export function initSchema(db: DbLike): void {
  for (const statement of SCHEMA_STATEMENTS) {
    db.exec(statement)
  }
}
