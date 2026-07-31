// Importer boundary. `createDictService` delegates import
// work through this interface so `workerImporter.ts` can swap in a
// worker-backed implementation without touching lookup/list/order/remove,
// which keep using the main-process DB handle directly.

import { importDictionary, type ImportDb } from './yomitanImport'
import type { ImportResult } from '../../../shared/dictionary'

export interface DictionaryImporter {
  /** `onProgress`, if given, is called periodically with `(done, total)` term
   * rows inserted — advisory, see `importDictionary`. */
  import(
    zipBytes: Uint8Array,
    onProgress?: (done: number, total: number) => void
  ): Promise<ImportResult>
}

/** Default importer: runs the existing synchronous import transaction against `db` on the main thread. */
export function createDbImporter(db: ImportDb): DictionaryImporter {
  return {
    import: async (
      zipBytes: Uint8Array,
      onProgress?: (done: number, total: number) => void
    ): Promise<ImportResult> => importDictionary(zipBytes, db, onProgress)
  }
}
