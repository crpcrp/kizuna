// The import logic is separated from the worker_threads entry point so it can
// be tested without parentPort or workerData.

import { parentPort, workerData } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { importDictionary, type ImportDb } from './yomitanImport'
import type { ImportResult } from '../../../shared/dictionary'

export interface ImportWorkerInput {
  dbPath: string
  zipBytes: Uint8Array
}

/** Structural subset of better-sqlite3's Database the worker needs, beyond ImportDb. */
export interface WorkerDb extends ImportDb {
  pragma(source: string, options?: { simple?: boolean }): unknown
  close(): void
}

export type OpenDb = (dbPath: string) => WorkerDb

const defaultOpenDb: OpenDb = (dbPath) => new Database(dbPath) as unknown as WorkerDb

/** `PRAGMA auto_vacuum` values (0 = NONE, 1 = FULL, 2 = INCREMENTAL). */
const AUTO_VACUUM_NONE = 0
const AUTO_VACUUM_INCREMENTAL = 2

/**
 * Converts a legacy `auto_vacuum = NONE` dict.db to INCREMENTAL, once.
 *
 * `configureDictConnection` sets the pragma on every connection, but SQLite
 * ignores it on a file whose header already exists — changing the mode needs a
 * full `VACUUM`. Every dict.db created before that pragma landed is therefore
 * stuck on NONE forever, which means freed pages are never returned to the OS:
 * `reclaimFreedPages` takes its 'deferred' branch, nothing else ever vacuums,
 * and the file only grows. One real database reached 1.12 GB holding 189 MB of
 * dictionaries — 83% of it unreclaimable free pages.
 *
 * The conversion runs here, in the import worker, for two reasons: it is off
 * the main loop so a multi-second rewrite cannot freeze the UI, and an import
 * is already a "please wait" operation the user is watching. Returns whether it
 * converted, so callers and tests can tell the paths apart.
 */
export function migrateAutoVacuum(db: WorkerDb): boolean {
  if (Number(db.pragma('auto_vacuum', { simple: true })) !== AUTO_VACUUM_NONE) return false
  db.pragma(`auto_vacuum = ${AUTO_VACUUM_INCREMENTAL}`)
  db.exec('VACUUM')
  return true
}

/**
 * Returns the space an import left behind to the operating system.
 *
 * The whole import is one transaction, and SQLite cannot checkpoint mid
 * transaction, so every inserted page piles up in dict.db-wal until the commit
 * — jitendex alone peaks at ~600 MB of WAL. A plain (PASSIVE) checkpoint folds
 * those pages back into the database but leaves the -wal file at its
 * high-water mark for the rest of the session; TRUNCATE returns it. The
 * incremental vacuum then hands back pages freed by the vacuum-enabled path.
 */
export function reclaimAfterImport(db: WorkerDb): void {
  if (Number(db.pragma('auto_vacuum', { simple: true })) === AUTO_VACUUM_INCREMENTAL) {
    db.pragma('incremental_vacuum')
  }
  const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)')
  if (isBusyCheckpoint(checkpoint)) db.pragma('wal_checkpoint(TRUNCATE)')
}

function isBusyCheckpoint(result: unknown): boolean {
  if (!Array.isArray(result) || result.length === 0) return false
  const [row] = result
  return typeof row === 'object' && row !== null && 'busy' in row && Number(row.busy) !== 0
}

/**
 * Runs one dictionary import against its own DB connection: opens `dbPath`,
 * sets a WAL journal and a busy timeout (so this can run alongside
 * main-thread reads without immediately hitting SQLITE_BUSY), migrates a legacy
 * database off `auto_vacuum = NONE`, then runs the existing import transaction
 * and returns the WAL space it used. Always closes the connection, even on
 * failure. Exported standalone so the worker's actual logic is testable
 * without spinning up a real worker thread. `onProgress`, if given, is
 * forwarded straight to `importDictionary` (advisory `{ done, total }`).
 */
export function runImportInWorker(
  input: ImportWorkerInput,
  openDb: OpenDb = defaultOpenDb,
  onProgress?: (done: number, total: number) => void
): ImportResult {
  const db = openDb(input.dbPath)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
    // Must precede the import: neither VACUUM nor a checkpoint can run inside
    // the import's transaction.
    migrateAutoVacuum(db)
    const result = importDictionary(input.zipBytes, db, onProgress)
    reclaimAfterImport(db)
    return result
  } finally {
    db.close()
  }
}

if (parentPort) {
  try {
    const result = runImportInWorker(workerData as ImportWorkerInput, undefined, (done, total) => {
      parentPort!.postMessage({ type: 'progress', done, total })
    })
    parentPort.postMessage({ type: 'result', result })
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
