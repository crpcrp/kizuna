// Knowledge DB access. The DB handle is injected (never
// constructed here); callers run `initSchema(db)` once at service creation,
// mirroring services/dict/lookup.ts's relationship to dict/schema.ts.

import type { DbLike } from './schema'
import {
  isKnowledgeSourceDetail,
  maxKnowledgeLevel,
  normalizeKnowledgeLemma,
  type KnowledgeDetails,
  type KnowledgeLevel,
  type KnowledgeSource,
  type KnowledgeSourceDetail
} from '../../../shared/knowledge'
import { mergeLevel } from './levels'

/** Structural subset of better-sqlite3's `Database` this module needs. */
export interface KnowledgeDb extends DbLike {
  prepare(sql: string): {
    run(...params: unknown[]): unknown
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
}

export interface KnownRow {
  source: string
  lemma: string
  reading: string
  level: KnowledgeLevel
  srsStage?: number
  metadata?: KnowledgeSourceDetail | KnowledgeSourceDetail[]
}

/** SQLite's default host-parameter limit is 999; stay well under it. */
const LEMMA_CHUNK_SIZE = 500

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * Full-replace sync for one source: deletes every existing `known_words` row
 * for `source`, then bulk-inserts `rows`, in a single transaction. Full
 * replace (not upsert) so a word demoted at the source (e.g. a WaniKani SRS
 * reset) loses its row instead of being stranded by a diff-based upsert.
 * Returns the number of rows inserted.
 */
export function replaceSource(
  db: KnowledgeDb,
  source: string,
  rows: KnownRow[],
  now: string
): number {
  const del = db.prepare('DELETE FROM known_words WHERE source = ?')
  const insert = db.prepare(
    `INSERT INTO known_words (source, lemma, reading, level, srs_stage, metadata_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const run = db.transaction((): number => {
    del.run(source)
    for (const row of rows) {
      insert.run(
        row.source,
        row.lemma,
        row.reading,
        row.level,
        row.srsStage ?? null,
        row.metadata ? JSON.stringify(row.metadata) : null,
        now
      )
    }
    return rows.length
  })
  return run()
}

/**
 * Looks up every `known_words` row whose lemma is in `lemmas`, chunking the
 * `IN (...)` query at `LEMMA_CHUNK_SIZE` params. A lemma known from more
 * than one source merges to the higher-ranked level (`mergeLevel`); a lemma
 * with no row anywhere is simply absent from the result (never 'unknown' —
 * absence *is* unknown, per the schema's design).
 */
export function levelsFor(db: KnowledgeDb, lemmas: string[]): Record<string, KnowledgeLevel> {
  const result: Record<string, KnowledgeLevel> = {}
  for (const batch of chunk(lemmas, LEMMA_CHUNK_SIZE)) {
    if (batch.length === 0) continue
    const placeholders = batch.map(() => '?').join(', ')
    const rows = db
      .prepare(`SELECT lemma, level FROM known_words WHERE lemma IN (${placeholders})`)
      .all(...batch) as Array<{ lemma: string; level: KnowledgeLevel }>
    for (const row of rows) {
      const existing = result[row.lemma]
      result[row.lemma] = existing ? mergeLevel(existing, row.level) : row.level
    }
  }
  return result
}

/**
 * Looks up merged knowledge levels plus every source kind and valid source
 * detail for each lemma. Null, malformed, and legacy metadata contributes only
 * its source kind and level, so upgrading an existing knowledge DB cannot break
 * coloring or provenance accounting.
 */
export function detailsFor(db: KnowledgeDb, lemmas: string[]): Record<string, KnowledgeDetails> {
  const result: Record<string, KnowledgeDetails> = {}
  for (const batch of chunk(lemmas, LEMMA_CHUNK_SIZE)) {
    if (batch.length === 0) continue
    const placeholders = batch.map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT source, lemma, level, metadata_json FROM known_words
         WHERE lemma IN (${placeholders})
         ORDER BY lemma, CASE source WHEN 'wanikani' THEN 0 WHEN 'anki' THEN 1 ELSE 2 END, reading`
      )
      .all(...batch) as Array<{
      source: string
      lemma: string
      level: KnowledgeLevel
      metadata_json: string | null
    }>
    mergeKnowledgeRows(result, rows)
  }
  return sortDetails(result)
}

/** Returns one merged, normalized details value for every tracked lemma. */
export function detailsForAll(db: KnowledgeDb): Record<string, KnowledgeDetails> {
  const rows = db
    .prepare(
      `SELECT source, lemma, level, metadata_json FROM known_words
       ORDER BY lemma, CASE source WHEN 'wanikani' THEN 0 WHEN 'anki' THEN 1 ELSE 2 END, reading`
    )
    .all() as Array<{
    source: string
    lemma: string
    level: KnowledgeLevel
    metadata_json: string | null
  }>
  const result: Record<string, KnowledgeDetails> = {}
  mergeKnowledgeRows(result, rows)
  return sortDetails(result)
}

type KnowledgeDetailsRow = {
  source: string
  lemma: string
  level: KnowledgeLevel
  metadata_json: string | null
}

function mergeKnowledgeRows(
  result: Record<string, KnowledgeDetails>,
  rows: KnowledgeDetailsRow[]
): void {
  for (const row of rows) {
    const lemma = normalizeKnowledgeLemma(row.lemma)
    if (lemma === '') continue

    const existing = result[lemma]
    const sourceKind = toKnowledgeSource(row.source)
    result[lemma] = {
      level: existing ? maxKnowledgeLevel(existing.level, row.level) : row.level,
      sourceKinds: sourceKind
        ? [...new Set([...(existing?.sourceKinds ?? []), sourceKind])].sort(sourceKindOrder)
        : [...(existing?.sourceKinds ?? [])],
      sources: [...(existing?.sources ?? []), ...parseSourceDetails(row.metadata_json)]
    }
  }
}

function sortDetails(details: Record<string, KnowledgeDetails>): Record<string, KnowledgeDetails> {
  return Object.fromEntries(
    Object.entries(details).sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
  )
}

function toKnowledgeSource(source: string): KnowledgeSource | undefined {
  return source === 'wanikani' || source === 'anki' ? source : undefined
}

function sourceKindOrder(a: KnowledgeSource, b: KnowledgeSource): number {
  return (a === 'wanikani' ? 0 : 1) - (b === 'wanikani' ? 0 : 1)
}

function parseSourceDetails(metadataJson: string | null): KnowledgeSourceDetail[] {
  if (metadataJson === null) return []
  try {
    const metadata: unknown = JSON.parse(metadataJson)
    if (isKnowledgeSourceDetail(metadata)) return [metadata]
    return Array.isArray(metadata) && metadata.every(isKnowledgeSourceDetail) ? metadata : []
  } catch {
    return []
  }
}

export function getSyncState(db: KnowledgeDb, source: string): { lastSyncAt: string | null } {
  const row = db.prepare('SELECT last_sync_at FROM sync_state WHERE source = ?').get(source) as
    { last_sync_at: string | null } | undefined
  return { lastSyncAt: row ? row.last_sync_at : null }
}

export function setSyncState(db: KnowledgeDb, source: string, lastSyncAt: string): void {
  db.prepare(
    `INSERT INTO sync_state (source, last_sync_at) VALUES (?, ?)
     ON CONFLICT(source) DO UPDATE SET last_sync_at = excluded.last_sync_at`
  ).run(source, lastSyncAt)
}

/**
 * Forgets a source's last-sync timestamp — used when the source's credentials
 * change and its rows were purged, so the next sync with the new credentials
 * isn't blocked by the manual-sync cooldown.
 */
export function clearSyncState(db: KnowledgeDb, source: string): void {
  db.prepare('DELETE FROM sync_state WHERE source = ?').run(source)
}

/** Row counts per source, for the Options UI's "8,412 words" summary. */
export function countBySource(db: KnowledgeDb): Record<string, number> {
  const rows = db
    .prepare('SELECT source, COUNT(*) AS n FROM known_words GROUP BY source')
    .all() as Array<{
    source: string
    n: number
  }>
  const result: Record<string, number> = {}
  for (const row of rows) result[row.source] = row.n
  return result
}
