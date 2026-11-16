// Shared MeCab dictionary DTO, crossing main/preload/renderer. Pure data.

import type { DictFlavor } from './token'

/** A MeCab dictionary the app can pass to `-d` when invoking MeCab. */
export interface McDict {
  id: 'ipadic' | 'unidic'
  label: string
  dicdir: string
  flavor: DictFlavor
  /** Missing dictionaries remain visible in Options but cannot be selected. */
  installed: boolean
}
