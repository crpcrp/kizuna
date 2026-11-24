CREATE TABLE known_words (
  source     TEXT NOT NULL,
  lemma      TEXT NOT NULL,
  reading    TEXT NOT NULL DEFAULT '',
  level      TEXT NOT NULL,
  srs_stage  INTEGER,
  metadata_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, lemma, reading)
);
CREATE TABLE sync_state (
  source       TEXT PRIMARY KEY,
  last_sync_at TEXT,
  cursor       TEXT
);
CREATE INDEX idx_known_lemma ON known_words (lemma);
INSERT INTO known_words (source, lemma, reading, level, srs_stage, metadata_json, updated_at) VALUES ('wanikani', '猫', 'ねこ', 'known', 5, NULL, '2026-01-01T00:00:00.000Z');
INSERT INTO sync_state (source, last_sync_at) VALUES ('wanikani', '2026-01-01T00:00:00.000Z');
