// Test harness — fake `DictionaryImporter` (AGENTS.md law 3: no real
// unzip/DB transaction). Records calls and returns a scripted result, so
// tests can prove `createDictService` delegates through the boundary
// instead of importing directly.

import type { DictionaryImporter } from '../../src/main/services/dict/importer'
import type { ImportResult } from '../../src/shared/dictionary'

export function fakeDictImporter(result: ImportResult): DictionaryImporter & {
  calls: Uint8Array[]
} {
  const calls: Uint8Array[] = []
  return {
    calls,
    import: async (
      zipBytes: Uint8Array,
      onProgress?: (done: number, total: number) => void
    ): Promise<ImportResult> => {
      calls.push(zipBytes)
      onProgress?.(result.termCount, result.termCount)
      return result
    }
  }
}
