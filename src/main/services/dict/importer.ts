import { readFileSync } from 'node:fs'
import { importDictionary, type ImportDb } from './yomitanImport'
import type { ImportResult } from '../../../shared/dictionary'

export type DictZipSource = Uint8Array | string

export function readDictZip(source: DictZipSource): Uint8Array {
  return typeof source === 'string' ? readFileSync(source) : source
}

export interface DictionaryImporter {
  /** Progress is advisory; await the import result for completion. */
  import(
    zip: DictZipSource,
    onProgress?: (done: number, total: number) => void
  ): Promise<ImportResult>
}

export function createDbImporter(db: ImportDb): DictionaryImporter {
  return {
    import: async (
      zip: DictZipSource,
      onProgress?: (done: number, total: number) => void
    ): Promise<ImportResult> => importDictionary(readDictZip(zip), db, onProgress)
  }
}
