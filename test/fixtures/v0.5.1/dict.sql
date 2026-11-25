CREATE TABLE dictionaries (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  revision TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 0,
  frequency_mode TEXT NOT NULL DEFAULT 'rank-based',
  fallback_only INTEGER NOT NULL DEFAULT 0,
  styles_css TEXT
);
CREATE TABLE terms (
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
, glossary_json TEXT);
CREATE TABLE term_meta (
  id INTEGER PRIMARY KEY,
  dict_id INTEGER NOT NULL,
  expression TEXT NOT NULL,
  reading TEXT,
  mode TEXT NOT NULL,
  value INTEGER,
  display TEXT,
  pitch_positions TEXT
);
CREATE INDEX idx_terms_expression ON terms (expression);
CREATE INDEX idx_terms_reading ON terms (reading);
CREATE INDEX idx_term_meta_expr ON term_meta (dict_id, expression);
INSERT INTO dictionaries (id, title, revision, schema_version, styles_css) VALUES (1, 'JMdict', 'r1', 4, NULL);
INSERT INTO terms (id, dict_id, expression, reading, glossary, glossary_json) VALUES (1, 1, '猫', 'ねこ', 'cat', '["cat"]');
INSERT INTO term_meta (id, dict_id, expression, reading, mode, pitch_positions) VALUES (1, 1, '猫', 'ねこ', 'pitch', '[1]');
