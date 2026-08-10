// MeCab dictionary registry. Pure resolver: no disk access
// itself; the caller injects an `exists` boundary so this stays unit-testable.

import type { McDict } from '../../../shared/mecab'

/**
 * Lists the MeCab dictionaries the app knows about, each flagged with whether
 * it is installed.
 *
 * Both entries are always returned: Options shows UniDic as "Missing" rather
 * than hiding it, so users learn it exists. IPADIC is bundled, hence always
 * installed. UniDic is installed only when a directory resolves via `exists`,
 * preferring the persistent `userUnidicDir` over the bundled `unidicDir` when
 * both are present. When neither exists its `dicdir` falls back to the
 * persistent candidate first (or the bundled candidate when no user path was
 * configured), and callers must refuse to select it.
 */
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
