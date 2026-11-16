export interface DbLike {
  exec(sql: string): unknown
}

/** Bump when the on-disk schema shape changes; stored per-dictionary row. */
export const CURRENT_DICT_SCHEMA_VERSION = 4

const CREATE_DICTIONARIES_TABLE = `
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

const CREATE_TERMS_TABLE = `
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

const CREATE_TERMS_EXPRESSION_INDEX = `
CREATE INDEX IF NOT EXISTS idx_terms_expression ON terms (expression)`

const CREATE_TERMS_READING_INDEX = `
CREATE INDEX IF NOT EXISTS idx_terms_reading ON terms (reading)`

// Pitch entries can have multiple drop positions, stored as a JSON integer array
// in pitch_positions; value/display remain reserved for frequency data.
const CREATE_TERM_META_TABLE = `
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

const CREATE_TERM_META_EXPRESSION_INDEX = `
CREATE INDEX IF NOT EXISTS idx_term_meta_expr ON term_meta (dict_id, expression)`

const SCHEMA_STATEMENTS = [
  CREATE_DICTIONARIES_TABLE,
  CREATE_TERMS_TABLE,
  CREATE_TERM_META_TABLE,
  CREATE_TERMS_EXPRESSION_INDEX,
  CREATE_TERMS_READING_INDEX,
  CREATE_TERM_META_EXPRESSION_INDEX
]

export function initSchema(db: DbLike): void {
  for (const statement of SCHEMA_STATEMENTS) {
    db.exec(statement)
  }
}
