// Callers decode both M3U and M3U8 as UTF-8; legacy encodings such as CP932 are unsupported.

import { normalizeMediaPath, type PathPlatform } from './mediaHistory'
import { isRemoteUrl } from './mediaFileTypes'

export interface M3uParseOptions {
  /** Platform whose path rules apply; defaults to the runtime platform. */
  platform?: PathPlatform
}

/** Resolve relative entries against the playlist folder; skip URL schemes because playback is local-only. */
export function parseM3u(text: string, baseDir: string, options: M3uParseOptions = {}): string[] {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const paths: string[] = []
  for (const rawLine of withoutBom.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    if (isRemoteUrl(line)) continue
    const resolved = normalizeMediaPath(line, { platform: options.platform, cwd: baseDir })
    if (resolved) paths.push(resolved)
  }
  return paths
}

/** Serializes paths to M3U text: an `#EXTM3U` header then one path per line. */
export function serializeM3u(paths: string[]): string {
  return `${['#EXTM3U', ...paths.filter((path) => !isRemoteUrl(path))].join('\n')}\n`
}
