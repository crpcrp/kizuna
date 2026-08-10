// Filesystem-backed validation for MeCab dictionary directories. The registry
// remains pure; production injects this predicate so tests can exercise the
// fallback without a real MeCab installation.

import { pathApiFor } from '../../platformPath'

const REQUIRED_MECAB_FILES = ['char.bin', 'dicrc', 'matrix.bin', 'sys.dic', 'unk.dic']

export interface MecabDictionaryStatLike {
  isDirectory(): boolean
  isFile(): boolean
}

export interface MecabDictionaryFsLike {
  statSync(path: string): MecabDictionaryStatLike
}

/** Returns true only for a directory containing the compiled MeCab payload. */
export function isValidMecabDictionaryDir(
  directory: string,
  fs: MecabDictionaryFsLike,
  platform: NodeJS.Platform = process.platform
): boolean {
  try {
    if (!fs.statSync(directory).isDirectory()) return false
    const pathApi = pathApiFor(platform)
    return REQUIRED_MECAB_FILES.every((name) => fs.statSync(pathApi.join(directory, name)).isFile())
  } catch {
    return false
  }
}
