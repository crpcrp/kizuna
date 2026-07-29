// Shared MeCab dictionary DTO, crossing main/preload/renderer. Pure data.

import type { DictFlavor } from './token'

/** A MeCab dictionary the app can pass to `-d` when invoking MeCab. */
export interface McDict {
  id: 'ipadic' | 'unidic'
  label: string
  dicdir: string
  flavor: DictFlavor
  /** Whether the dictionary's directory is actually on disk. Uninstalled dicts
   * are still listed (so Options can show them as "Missing") but must never be
   * selected — their `dicdir` is empty or unusable. */
  installed: boolean
}
