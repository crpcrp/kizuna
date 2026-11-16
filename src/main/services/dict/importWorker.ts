// The import logic is separated from the worker_threads entry point so it can
// be tested without parentPort or workerData.

import { parentPort, workerData } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { importDictionary, type ImportDb } from './yomitanImport'
import { readDictZip } from './importer'
import type { ImportResult } from '../../../shared/dictionary'

/** `zipPath` is read inside the worker so the archive never sits in main-process memory. */
export type ImportWorkerInput =
  { dbPath: string; zipBytes: Uint8Array } | { dbPath: string; zipPath: string }

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

// Existing SQLite headers ignore auto_vacuum changes until VACUUM; do the rewrite off the main loop.
// One 1.12 GB database held only 189 MB of dictionaries before conversion.
export function migrateAutoVacuum(db: WorkerDb): boolean {
  if (Number(db.pragma('auto_vacuum', { simple: true })) !== AUTO_VACUUM_NONE) return false
  db.pragma(`auto_vacuum = ${AUTO_VACUUM_INCREMENTAL}`)
  db.exec('VACUUM')
  return true
}

// Imports can leave ~600 MB of WAL for jitendex; TRUNCATE returns it, unlike a passive checkpoint.
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

// Use a separate connection with WAL and a busy timeout so imports can coexist with main-thread reads.
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
    const zip = readDictZip('zipPath' in input ? input.zipPath : input.zipBytes)
    const result = importDictionary(zip, db, onProgress)
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
