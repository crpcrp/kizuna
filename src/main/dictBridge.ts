// Database and importer boundaries are injected so bridge and service tests can
// use in-memory databases.

import { DICT_CHANNELS } from '../shared/ipcChannels'
import type { IpcMainHandleLike } from './ipc'
import { pathApiFor } from './platformPath'
import { initSchema, CURRENT_DICT_SCHEMA_VERSION, type DbLike } from './services/dict/schema'
import { lookup as runLookup } from './services/dict/lookup'
import { createDbImporter, type DictionaryImporter } from './services/dict/importer'
import { defaultJlptClassifier, type JlptClassifier } from './services/jlpt/classifier'
import type { DictInfo, ImportResult, FrequencyMode, LookupResult } from '../shared/dictionary'

/**
 * Resolves the compiled import-worker entry (importWorker.ts's build
 * output) from the main process's own `__dirname`. electron-vite writes
 * main/preload output to disk in both `dev` (watch-mode build) and packaged
 * runs — only the renderer differs (HTTP dev server vs. loadFile) — so
 * `__dirname` is `out/main` in both cases and one join covers both, mirroring
 * how `index.ts` already resolves the preload path off the same `__dirname`.
 */
export function resolveImportWorkerPath(
  dirname: string,
  platform: NodeJS.Platform = process.platform
): string {
  return pathApiFor(platform).join(dirname, 'importWorker.js')
}

/** The slice of the dict service this bridge needs (fakeable in tests). */
export interface DictServiceLike {
  importDict(
    zipBytes: Uint8Array,
    onProgress?: (done: number, total: number) => void
  ): Promise<ImportResult>
  lookup(
    lemma: string,
    reading?: string,
    freqDictId?: number | null,
    sortMode?: FrequencyMode,
    longestMatchCandidates?: string[],
    surface?: string
  ): Promise<LookupResult[]>
  listDicts(): Promise<DictInfo[]>
  setEnabled(id: number, enabled: boolean): Promise<void>
  setFallbackOnly(id: number, fallbackOnly: boolean): Promise<void>
  reorder(orderedIds: number[]): Promise<void>
  removeDict(id: number): Promise<void>
}

/** Injected main→renderer push (real impl: broadcasts via `webContents.send`). */
export type DictEventSender = (channel: string, value: unknown) => void

const noopSend: DictEventSender = () => {}

/**
 * Registers the dict command channels ('dict:importDict', 'dict:lookup',
 * 'dict:listDicts', 'dict:setEnabled', 'dict:setFallbackOnly', 'dict:reorder') against the
 * ipcMain-like object, forwarding each call to `service`. While an import is
 * in flight, its advisory `{ done, total }` progress is pushed to the
 * renderer over 'dict:importProgress' via `send` (defaults to a no-op, so
 * existing callers/tests that don't care about progress don't need to pass
 * one).
 */
export function registerDictBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: DictServiceLike,
  send: DictEventSender = noopSend
): void {
  ipc.handle(DICT_CHANNELS.importDict, (_e, zipBytes) =>
    service.importDict(zipBytes, (done, total) =>
      send(DICT_CHANNELS.importProgress, { done, total })
    )
  )
  ipc.handle(
    DICT_CHANNELS.lookup,
    (_e, lemma, reading, freqDictId, sortMode, longestMatchCandidates, surface) =>
      service.lookup(lemma, reading, freqDictId, sortMode, longestMatchCandidates, surface)
  )
  ipc.handle(DICT_CHANNELS.listDicts, () => service.listDicts())
  ipc.handle(DICT_CHANNELS.setEnabled, (_e, id, enabled) => service.setEnabled(id, enabled))
  ipc.handle(DICT_CHANNELS.setFallbackOnly, (_e, id, fallbackOnly) =>
    service.setFallbackOnly(id, fallbackOnly)
  )
  ipc.handle(DICT_CHANNELS.reorder, (_e, orderedIds) => service.reorder(orderedIds))
  ipc.handle(DICT_CHANNELS.remove, (_e, id) => service.removeDict(id))
}

/**
 * Structural subset of better-sqlite3's `Database` the dict service needs —
 * a superset covering ImportDb's insert/transaction usage and LookupDb's
 * read-only usage (matches both structurally, no need to literally extend
 * either, since their `transaction`/`prepare` shapes differ slightly).
 */
export interface DictDb extends DbLike {
  prepare(sql: string): {
    run(...params: unknown[]): { lastInsertRowid: number | bigint }
    all(...params: unknown[]): unknown[]
  }
  transaction<T>(fn: () => T): () => T
  pragma(source: string, options?: { simple?: boolean }): unknown
}

/** `PRAGMA auto_vacuum` value for INCREMENTAL mode (0 = NONE, 1 = FULL). */
const AUTO_VACUUM_INCREMENTAL = 2

/**
 * Applies the connection pragmas the main-process dict.db handle needs, in the
 * one order that works. `auto_vacuum` must come first: on a brand-new file
 * `journal_mode = WAL` writes the database header, and once that header exists
 * SQLite will not change the auto-vacuum mode without a full `VACUUM`. Setting
 * it afterwards silently leaves a fresh install on `auto_vacuum = NONE`, which
 * is exactly the full-rewrite cost `reclaimFreedPages`'s incremental path avoids.
 *
 * WAL + a busy timeout keep this connection's reads from blocking on — or being
 * blocked by — the import worker's writes to the same file.
 */
export function configureDictConnection(db: DictDb): void {
  db.pragma('auto_vacuum = INCREMENTAL')
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
}

/**
 * Reclaims the pages a dictionary removal freed. `PRAGMA incremental_vacuum`
 * only moves the free pages the DB already tracks, so it costs time
 * proportional to what was deleted — unlike `VACUUM`, which rewrites the whole
 * file and can block the main process for seconds on a large multi-dictionary
 * install.
 *
 * Incremental vacuuming needs `auto_vacuum = INCREMENTAL`, and SQLite only
 * switches that mode through a full `VACUUM`. A dict.db created before this
 * change may still be `auto_vacuum = NONE`; leave that conversion to a future
 * explicit or idle migration instead of blocking the first removal on a
 * full-file rewrite. Returns which path it took so tests can tell them apart.
 */
export function reclaimFreedPages(db: DictDb): 'incremental' | 'deferred' {
  if (Number(db.pragma('auto_vacuum', { simple: true })) === AUTO_VACUUM_INCREMENTAL) {
    db.pragma('incremental_vacuum')
    return 'incremental'
  }
  // Legacy databases may still use auto_vacuum = NONE. Changing that mode
  // requires a full VACUUM, so defer conversion to an explicit or idle
  // migration instead of blocking the first dictionary removal.
  return 'deferred'
}

export interface CreateDictServiceDeps {
  db: DictDb
  /** Defaults to an in-process importer; index.ts supplies the worker-backed importer. */
  importer?: DictionaryImporter
  /** Defaults to the bundled classifier; tests inject a small fixture-backed fake. */
  jlptClassifier?: JlptClassifier
}

interface DictRow {
  id: number
  title: string
  revision: string
  enabled: number
  priority: number
  schema_version: number
  fallback_only: number
}

/**
 * Eagerly runs `initSchema` so
 * `listDicts`/`lookup` don't fail against a brand-new DB file before any
 * import has happened (mirrors `importDictionary`'s own defensive call).
 */
export function createDictService(deps: CreateDictServiceDeps): DictServiceLike {
  const { db } = deps
  const importer = deps.importer ?? createDbImporter(db)
  const jlptClassifier = deps.jlptClassifier ?? defaultJlptClassifier
  // Covers callers that hand over a bare connection (tests, in-memory DBs); the
  // main process has already done this via `configureDictConnection`, which has
  // to run before its `journal_mode` pragma. Either way it must precede the
  // first CREATE TABLE — once the file has a header, changing the mode would
  // require a full VACUUM, so legacy conversion remains a deferred migration.
  db.pragma('auto_vacuum = INCREMENTAL')
  initSchema(db)
  db.prepare(
    'DELETE FROM term_meta WHERE NOT EXISTS (SELECT 1 FROM dictionaries WHERE dictionaries.id = term_meta.dict_id)'
  ).run()

  return {
    async importDict(
      zipBytes: Uint8Array,
      onProgress?: (done: number, total: number) => void
    ): Promise<ImportResult> {
      initSchema(db)
      return importer.import(zipBytes, onProgress)
    },

    async lookup(
      lemma: string,
      reading?: string,
      freqDictId?: number | null,
      sortMode?: FrequencyMode,
      longestMatchCandidates?: string[],
      surface?: string
    ): Promise<LookupResult[]> {
      const results = runLookup(
        db,
        { lemma, reading, surface, longestMatchCandidates },
        { freqDictId, sortMode }
      )
      return results.map((result) => ({
        ...result,
        jlptLevel: jlptClassifier.levelFor(result.expression, result.reading)
      }))
    },

    async listDicts(): Promise<DictInfo[]> {
      const rows = db
        .prepare(
          `SELECT id, title, revision, enabled, priority, schema_version, fallback_only
           FROM dictionaries
           ORDER BY priority ASC, id ASC`
        )
        .all() as DictRow[]
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        revision: row.revision,
        enabled: row.enabled === 1,
        fallbackOnly: row.fallback_only === 1,
        priority: row.priority,
        schemaVersion: row.schema_version,
        needsReimport: row.schema_version < CURRENT_DICT_SCHEMA_VERSION
      }))
    },

    async setEnabled(id: number, enabled: boolean): Promise<void> {
      db.prepare('UPDATE dictionaries SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
    },

    async setFallbackOnly(id: number, fallbackOnly: boolean): Promise<void> {
      db.prepare('UPDATE dictionaries SET fallback_only = ? WHERE id = ?').run(
        fallbackOnly ? 1 : 0,
        id
      )
    },

    async reorder(orderedIds: number[]): Promise<void> {
      const updatePriority = db.prepare('UPDATE dictionaries SET priority = ? WHERE id = ?')
      const runReorder = db.transaction((): void => {
        orderedIds.forEach((id, index) => {
          updatePriority.run(index, id)
        })
      })
      runReorder()
    },

    async removeDict(id: number): Promise<void> {
      const deleteTermMeta = db.prepare('DELETE FROM term_meta WHERE dict_id = ?')
      const deleteTerms = db.prepare('DELETE FROM terms WHERE dict_id = ?')
      const deleteDict = db.prepare('DELETE FROM dictionaries WHERE id = ?')
      const runRemove = db.transaction((): void => {
        deleteTermMeta.run(id)
        deleteTerms.run(id)
        deleteDict.run(id)
      })
      runRemove()
      // Neither vacuum can run inside a transaction, so this happens after the
      // delete commits — it shrinks dict.db instead of leaving freed pages in
      // the freelist for SQLite to reuse.
      reclaimFreedPages(db)
    }
  }
}
