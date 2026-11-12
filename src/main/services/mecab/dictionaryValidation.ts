import { statSync } from 'node:fs'
import { join } from 'node:path'

const REQUIRED_MECAB_FILES = ['char.bin', 'dicrc', 'matrix.bin', 'sys.dic', 'unk.dic']

/** Returns true only for a directory containing the compiled MeCab payload. */
export function isValidMecabDictionaryDir(directory: string): boolean {
  try {
    if (!statSync(directory).isDirectory()) return false
    return REQUIRED_MECAB_FILES.every((name) => statSync(join(directory, name)).isFile())
  } catch {
    return false
  }
}
