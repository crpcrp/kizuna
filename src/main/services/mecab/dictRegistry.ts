// Phase 2 · Task B2 — MeCab dictionary registry. Pure resolver: no disk access
// itself; the caller injects an `exists` boundary so this stays unit-testable.

import type { McDict } from '../../../shared/mecab'

/**
 * Lists the MeCab dictionaries the app knows about, each flagged with whether
 * it is installed.
 *
 * Both entries are always returned: Options shows UniDic as "Missing" rather
 * than hiding it, so users learn it exists. IPADIC is bundled, hence always
 * installed. UniDic is installed only when a directory resolves via `exists`,
 * preferring the bundled `unidicDir` over a user-configured `userUnidicDir`
 * when both are present; when neither exists its `dicdir` falls back to the
 * best-known candidate path (or `''` when no candidate was configured), and
 * callers must refuse to select it.
 */
export function availableMecabDicts(
  paths: { ipadicDir: string; unidicDir?: string; userUnidicDir?: string },
  exists: (p: string) => boolean
): McDict[] {
  const unidicDir =
    paths.unidicDir && exists(paths.unidicDir)
      ? paths.unidicDir
      : paths.userUnidicDir && exists(paths.userUnidicDir)
        ? paths.userUnidicDir
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
      dicdir: unidicDir ?? paths.unidicDir ?? paths.userUnidicDir ?? '',
      flavor: 'unidic',
      installed: unidicDir !== undefined
    }
  ]
}
