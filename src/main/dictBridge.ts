import { statSync } from 'node:fs'
import { DICT_CHANNELS } from '../shared/ipcChannels'
import { isRemoteUrl } from '../shared/mediaFileTypes'
import type { IpcMainHandleLike } from './ipc'
import { expect, isNumberList, isStringList, nullable, oneOf, optional } from './ipcValidation'
import { isBoolean, isPositiveSafeInteger, isString } from '../shared/guards'
import { pathApiFor } from './platformPath'
import { initSchema, CURRENT_DICT_SCHEMA_VERSION, type DbLike } from './services/dict/schema'
import { lookup as runLookup } from './services/dict/lookup'
import {
  createDbImporter,
  type DictionaryImporter,
  type DictZipSource
} from './services/dict/importer'
import { MAX_UNZIP_TOTAL_BYTES } from './services/dict/yomitanArchive'
import { defaultJlptClassifier, type JlptClassifier } from './services/jlpt/classifier'
import type { DictInfo, ImportResult, FrequencyMode, LookupResult } from '../shared/dictionary'

// electron-vite writes the worker beside main output in both development and packaged runs.
export function resolveImportWorkerPath(
  dirname: string,
  platform: NodeJS.Platform = process.platform
): string {
  return pathApiFor(platform).join(dirname, 'importWorker.js')
}

// Reject compressed files exceeding the unzip budget before reading them into memory.
const MAX_DICT_ZIP_BYTES = MAX_UNZIP_TOTAL_BYTES

// Validate renderer paths before main or the worker reads a local archive.
function validateDictZipPath(value: string): string {
  if (value.trim() === '' || isRemoteUrl(value)) {
    throw new Error('Dictionary import needs a local file path')
  }
  if (!value.toLowerCase().endsWith('.zip')) {
    throw new Error('Dictionary import needs a .zip file')
  }
  const stat = statSync(value, { throwIfNoEntry: false })
  if (!stat?.isFile()) throw new Error('Dictionary file not found')
  if (stat.size > MAX_DICT_ZIP_BYTES) throw new Error('Dictionary file is too large to import')
  return value
}

export interface DictServiceLike {
  /** Bytes are for in-process callers and tests; the IPC bridge passes a validated path. */
  importDict(
    zip: DictZipSource,
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

export type DictEventSender = (channel: string, value: unknown) => void

const noopSend: DictEventSender = () => {}

export function registerDictBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: DictServiceLike,
  send: DictEventSender = noopSend
): void {
  const C = DICT_CHANNELS
  const zipPathArg = expect(isString, C.importDictFile)
  ipc.handle(C.importDictFile, (_e, zipPath) =>
    service.importDict(validateDictZipPath(zipPathArg(zipPath)), (done, total) =>
      send(C.importProgress, { done, total })
    )
  )
  const lemmaArg = expect(isString, C.lookup)
  const optionalStringArg = expect(optional(isString), C.lookup)
  const freqDictArg = expect(optional(nullable(isPositiveSafeInteger)), C.lookup)
  const sortModeArg = expect(optional(oneOf(FREQUENCY_MODES)), C.lookup)
  const candidatesArg = expect(optional(isStringList), C.lookup)
  ipc.handle(
    C.lookup,
    (_e, lemma, reading, freqDictId, sortMode, longestMatchCandidates, surface) =>
      service.lookup(
        lemmaArg(lemma),
        optionalStringArg(reading),
        freqDictArg(freqDictId),
        sortModeArg(sortMode),
        candidatesArg(longestMatchCandidates),
        optionalStringArg(surface)
      )
  )
  ipc.handle(C.listDicts, () => service.listDicts())
  const enabledId = expect(isPositiveSafeInteger, C.setEnabled)
  const enabledArg = expect(isBoolean, C.setEnabled)
  ipc.handle(C.setEnabled, (_e, id, enabled) =>
    service.setEnabled(enabledId(id), enabledArg(enabled))
  )
  const fallbackId = expect(isPositiveSafeInteger, C.setFallbackOnly)
  const fallbackArg = expect(isBoolean, C.setFallbackOnly)
  ipc.handle(C.setFallbackOnly, (_e, id, fallbackOnly) =>
    service.setFallbackOnly(fallbackId(id), fallbackArg(fallbackOnly))
  )
  const orderArg = expect(isDictIdList, C.reorder)
  ipc.handle(C.reorder, (_e, orderedIds) => service.reorder(orderArg(orderedIds)))
  const removeId = expect(isPositiveSafeInteger, C.remove)
  ipc.handle(C.remove, (_e, id) => service.removeDict(removeId(id)))
}

const FREQUENCY_MODES = [
  'rank-based',
  'occurrence-based'
] as const satisfies readonly FrequencyMode[]

function isDictIdList(value: unknown): value is number[] {
  return isNumberList(value) && value.every(isPositiveSafeInteger)
}

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

// Set auto_vacuum before WAL creates the header; later changes require a full VACUUM.
// WAL and the busy timeout allow reads alongside import-worker writes.
export function configureDictConnection(db: DictDb): void {
  db.pragma('auto_vacuum = INCREMENTAL')
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
}

// Incremental vacuum reclaims deleted pages without a blocking full-database rewrite.
export function reclaimFreedPages(db: DictDb): 'incremental' | 'deferred' {
  if (Number(db.pragma('auto_vacuum', { simple: true })) === AUTO_VACUUM_INCREMENTAL) {
    db.pragma('incremental_vacuum')
    return 'incremental'
  }
  // Converting auto_vacuum = NONE requires a full VACUUM; defer it to an explicit or idle migration.
  return 'deferred'
}

export interface CreateDictServiceDeps {
  db: DictDb
  /** Defaults to an in-process importer; index.ts supplies the worker-backed importer. */
  importer?: DictionaryImporter
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

export function createDictService(deps: CreateDictServiceDeps): DictServiceLike {
  const { db } = deps
  const importer = deps.importer ?? createDbImporter(db)
  const jlptClassifier = deps.jlptClassifier ?? defaultJlptClassifier
  // Bare connections also need auto_vacuum set before the first CREATE TABLE writes the header.
  db.pragma('auto_vacuum = INCREMENTAL')
  initSchema(db)
  db.prepare(
    'DELETE FROM term_meta WHERE NOT EXISTS (SELECT 1 FROM dictionaries WHERE dictionaries.id = term_meta.dict_id)'
  ).run()

  return {
    async importDict(
      zip: DictZipSource,
      onProgress?: (done: number, total: number) => void
    ): Promise<ImportResult> {
      initSchema(db)
      return importer.import(zip, onProgress)
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
      // Vacuum cannot run inside the deletion transaction.
      reclaimFreedPages(db)
    }
  }
}
