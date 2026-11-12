// Pure DDL strings + an `initSchema(db)` that applies them. The DB handle is
// injected (never constructed here) so tests can pass an in-memory
// better-sqlite3 instance and production code passes the real file handle.

/**
 * Structural subset of better-sqlite3's `Database` this module needs.
 * Kept minimal/structural since `better-sqlite3` ships no `.d.ts` and no
 * `@types/better-sqlite3` is installed — any object exposing `.exec()`
 * (real or fake) satisfies this.
 */
export interface DbLike {
  exec(sql: string): unknown
}

/** Bump when the on-disk schema shape changes; stored per-dictionary row. */
export const CURRENT_DICT_SCHEMA_VERSION = 4

export const CREATE_DICTIONARIES_TABLE = `
CREATE TABLE IF NOT EXISTS dictionaries (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  revision TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 0,
  frequency_mode TEXT NOT NULL DEFAULT 'rank-based',
  fallback_only INTEGER NOT NULL DEFAULT 0,
  styles_css TEXT
)`

export const CREATE_TERMS_TABLE = `
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY,
  dict_id INTEGER NOT NULL,
  expression TEXT NOT NULL,
  reading TEXT,
  glossary TEXT,
  term_tags TEXT,
  def_tags TEXT,
  rules TEXT,
  score INTEGER,
  sequence INTEGER,
  glossary_json TEXT
)`

export const CREATE_TERMS_EXPRESSION_INDEX = `
CREATE INDEX IF NOT EXISTS idx_terms_expression ON terms (expression)`

export const CREATE_TERMS_READING_INDEX = `
CREATE INDEX IF NOT EXISTS idx_terms_reading ON terms (reading)`

/**
 * Frequency/pitch metadata rows (Yomitan `term_meta_bank_N.json`).
 *
 * `value`/`display` carry frequency data (`mode = 'freq'`). Pitch rows
 * (`mode = 'pitch'`) leave both null and instead store their drop positions in
 * `pitch_positions` as a JSON array of integers (e.g. `[0,3]`) — a pitch entry
 * can hold several positions, so it does not fit the single numeric `value`
 * column, and overloading it would break frequency queries.
 */
export const CREATE_TERM_META_TABLE = `
CREATE TABLE IF NOT EXISTS term_meta (
  id INTEGER PRIMARY KEY,
  dict_id INTEGER NOT NULL,
  expression TEXT NOT NULL,
  reading TEXT,
  mode TEXT NOT NULL,
  value INTEGER,
  display TEXT,
  pitch_positions TEXT
)`

export const CREATE_TERM_META_EXPRESSION_INDEX = `
CREATE INDEX IF NOT EXISTS idx_term_meta_expr ON term_meta (dict_id, expression)`

/** All DDL statements, in dependency order (tables before their indexes). */
export const SCHEMA_STATEMENTS = [
  CREATE_DICTIONARIES_TABLE,
  CREATE_TERMS_TABLE,
  CREATE_TERM_META_TABLE,
  CREATE_TERMS_EXPRESSION_INDEX,
  CREATE_TERMS_READING_INDEX,
  CREATE_TERM_META_EXPRESSION_INDEX
]

/**
 * Creates the dictionary/term tables and lookup indexes on `db` if they
 * don't already exist. Idempotent — safe to call on every startup.
 */
export function initSchema(db: DbLike): void {
  for (const statement of SCHEMA_STATEMENTS) {
    db.exec(statement)
  }
}
