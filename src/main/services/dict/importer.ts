// Importer boundary. `createDictService` delegates import
// work through this interface so `workerImporter.ts` can swap in a
// worker-backed implementation without touching lookup/list/order/remove,
// which keep using the main-process DB handle directly.

import { readFileSync } from 'node:fs'
import { importDictionary, type ImportDb } from './yomitanImport'
import type { ImportResult } from '../../../shared/dictionary'

/** A dictionary zip: its bytes (tests, in-memory callers) or a validated local file path. */
export type DictZipSource = Uint8Array | string

/** Reads a path source from disk; byte sources pass through unchanged. */
export function readDictZip(source: DictZipSource): Uint8Array {
  return typeof source === 'string' ? readFileSync(source) : source
}

export interface DictionaryImporter {
  /** `onProgress`, if given, is called periodically with `(done, total)` term
   * rows inserted — advisory, see `importDictionary`. */
  import(
    zip: DictZipSource,
    onProgress?: (done: number, total: number) => void
  ): Promise<ImportResult>
}

/** Default importer: runs the existing synchronous import transaction against `db` on the main thread. */
export function createDbImporter(db: ImportDb): DictionaryImporter {
  return {
    import: async (
      zip: DictZipSource,
      onProgress?: (done: number, total: number) => void
    ): Promise<ImportResult> => importDictionary(readDictZip(zip), db, onProgress)
  }
}
