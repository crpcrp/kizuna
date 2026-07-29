// M3U / M3U8 playlist parse + serialize (Feature 1, slice 2). Pure and
// serializable so both the main process (file IO in mediaService) and the
// renderer can use it. Relative entries resolve against the playlist file's
// folder by reusing the lexical path normalizer from mediaHistory.
//
// Encoding: callers read `.m3u8` as UTF-8 always, and `.m3u` as UTF-8 too —
// Windows-legacy (CP932 etc.) encodings are out of scope. This module only
// ever sees decoded text.

import { normalizeMediaPath, type PathPlatform } from './mediaHistory'
import { isRemoteUrl } from './mediaFileTypes'

export interface M3uParseOptions {
  /** Platform whose path rules apply; defaults to the runtime platform. */
  platform?: PathPlatform
}

/**
 * Any `scheme://` URL entry (`https://`, `ftp://`, `file://`, …). Windows drive
 * paths (`C:\…`) and UNC roots (`\\nas\…`) have no `//` after the colon, so
 * they are not caught here and resolve as local paths.
 */
const URL_ENTRY = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Parses M3U/M3U8 text into media entries. Comment/directive lines
 * (`#EXTM3U`, `#EXTINF`, …) and blank lines are skipped; a leading BOM and
 * CRLF line endings are tolerated; relative local entries resolve against
 * `baseDir` (the playlist file's folder). Since Feature 9 (network streaming)
 * landed, `http(s)://` stream entries pass through verbatim — they are already
 * canonical, so no filesystem normalization or `baseDir` resolution applies
 * (mirrors `normalizeMediaPath`'s own URL guard). URL entries with any other
 * scheme (`ftp://`, `file://`, …) are not openable and are skipped.
 */
export function parseM3u(text: string, baseDir: string, options: M3uParseOptions = {}): string[] {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const paths: string[] = []
  for (const rawLine of withoutBom.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    if (URL_ENTRY.test(line)) {
      if (isRemoteUrl(line)) paths.push(line)
      continue
    }
    const resolved = normalizeMediaPath(line, { platform: options.platform, cwd: baseDir })
    if (resolved) paths.push(resolved)
  }
  return paths
}

/** Serializes paths to M3U text: an `#EXTM3U` header then one path per line. */
export function serializeM3u(paths: string[]): string {
  return `${['#EXTM3U', ...paths].join('\n')}\n`
}
