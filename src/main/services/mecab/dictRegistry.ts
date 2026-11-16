// MeCab dictionary registry. Pure resolver: no disk access
// itself; the caller injects an `exists` boundary so this stays unit-testable.

import type { McDict } from '../../../shared/mecab'

// Return missing UniDic too so Options can offer installation; prefer the persistent copy when installed.
export function availableMecabDicts(
  paths: { ipadicDir: string; unidicDir?: string; userUnidicDir?: string },
  exists: (p: string) => boolean,
  isValid: (p: string) => boolean = () => true
): McDict[] {
  const installed = (path: string | undefined): path is string =>
    path !== undefined && path !== '' && exists(path) && isValid(path)
  const unidicDir = installed(paths.userUnidicDir)
    ? paths.userUnidicDir
    : installed(paths.unidicDir)
      ? paths.unidicDir
      : undefined

  return [
    {
      id: 'ipadic',
      label: 'IPADIC',
      dicdir: paths.ipadicDir,
      flavor: 'ipadic',
      installed: true
    },
    {
      id: 'unidic',
      label: 'UniDic',
      dicdir: unidicDir ?? paths.userUnidicDir ?? paths.unidicDir ?? '',
      flavor: 'unidic',
      installed: unidicDir !== undefined
    }
  ]
}
